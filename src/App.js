import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, updateDoc, deleteDoc, getDocs, where, setDoc } from 'firebase/firestore';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, XAxis, YAxis, Tooltip, Legend, Bar, CartesianGrid } from 'recharts';

// Kullanıcının verdiği Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBtYfxOYk3t_7iHAdu3Jq8xGeO7Mvl2Vq8",
  authDomain: "uygulamam-20654.firebaseapp.com",
  projectId: "uygulamam-20654",
  storageBucket: "uygulamam-20654.firebasestorage.app",
  messagingSenderId: "1086300691373",
  appId: "1:1086300691373:web:b07b38583cc75b75ab1f24",
  measurementId: "G-RW4W4R500C"
};

const appId = 'uygulamam-20654';
const initialAuthToken = null;

// Helper function for number formatting (thousands separator and no decimals)
// Sayıları binlik ayraçlarla biçimlendirir ve ondalık basamakları kaldırır.
const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) {
        return '0';
    }
    return parseFloat(num).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

// Reusable Modal component
// Silme onayı gibi durumlar için özel bir modal penceresi sağlar.
const Modal = ({ show, title, message, onConfirm, onCancel, children, maxWidth = 'max-w-md' }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className={`bg-white p-6 rounded-lg shadow-xl w-full ${maxWidth}`}>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
                <p className="text-gray-700 mb-6">{message}</p>
                {children} {/* Modal içeriği için children prop'u eklendi */}
                <div className="flex justify-end space-x-3 mt-4">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                    >
                        İptal
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                    >
                        Onayla
                    </button>
                </div>
            </div>
        </div>
    );
};

// Reusable Toast Notification component
// Kullanıcıya kısa süreli geri bildirimler (başarı/hata mesajları) gösterir.
const Toast = ({ message, type, onClose }) => {
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    const textColor = 'text-white';

    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, 3000); // 3 saniye sonra otomatik kapanır
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div className={`fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${bgColor} ${textColor} z-50`}>
            {message}
        </div>
    );
};

// Yeni yardımcı fonksiyon: Verileri Excel'e aktarır
const exportDataToExcel = (data, columns, fileName, showToast) => {
    if (!window.XLSX) {
        showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
        return;
    }

    const headers = columns.map(col => col.header);
    const rows = data.map(item => {
        const row = {};
        columns.forEach(col => {
            // Render fonksiyonu varsa onu kullan, yoksa ham alanı kullan
            row[col.header] = col.render ? col.render(item) : item[col.field];
        });
        return row;
    });

    const ws = window.XLSX.utils.json_to_sheet(rows, { header: headers });
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, fileName);
    window.XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("Veriler başarıyla dışa aktarıldı!", "success");
};


// Ana uygulama bileşeni
function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState('dashboard'); // Mevcut sayfa durumu

    const [purchases, setPurchases] = useState([]); // Alım verileri
    const [sales, setSales] = useState([]); // Satış verileri
    const [transactions, setTransactions] = useState([]); // Gelir/Gider verileri
    const [paymentPlans, setPaymentPlans] = useState({}); // Payment plan data

    const [showModal, setShowModal] = useState(false); // Modal görünürlüğü
    const [modalContent, setModalContent] = useState({}); // Modal içeriği
    const [toast, setToast] = useState(null); // Toast bildirim içeriği
    const [isXLSXLoaded, setIsXLSXLoaded] = useState(false); // FIX: Added state for XLSX library loading status


    // Toast bildirimi göstermek için yardımcı fonksiyon
    const showToast = useCallback((message, type) => {
        setToast({ message, type });
    }, []);

    // Firebase başlatma ve kimlik doğrulama
    useEffect(() => {
        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const firebaseAuth = getAuth(app);

        setDb(firestore);
        setAuth(firebaseAuth);

        // Kullanıcı kimlik doğrulama durumunu dinle
        const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
            console.log('Firebase auth state changed:', user ? 'User logged in' : 'No user');
            if (user) {
                console.log('User ID:', user.uid);
                setUserId(user.uid);
            } else {
                // Gmail ile giriş yapılmamışsa login sayfasına yönlendir
                console.log('Kullanıcı giriş yapmamış');
            }
            setLoading(false);
        });

        return () => unsubscribe(); // Temizleme fonksiyonu
    }, [showToast]);

    // FIX: Check if XLSX library is loaded dynamically
    useEffect(() => {
        const script = document.createElement('script');
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.0/xlsx.full.min.js";
        script.async = true;
        script.onload = () => {
            setIsXLSXLoaded(true);
        };
        script.onerror = () => {
            console.error("XLSX kütüphanesi yüklenirken hata oluştu.");
            showToast("Excel dışa aktarma kütüphanesi yüklenemedi.", "error");
        };
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, [showToast]);


    // Firestore'dan veri çekme (tüm koleksiyonlar)
    useEffect(() => {
        if (db && userId) {
            // Alımlar koleksiyonunu dinle - Real-time
            const purchasesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/purchases`));
            const unsubscribePurchases = onSnapshot(purchasesQuery, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log('Real-time alımlar güncellendi:', data.length, 'kayıt');
                setPurchases(data);
            }, (error) => {
                console.error("Alımlar verisi çekilirken hata oluştu:", error);
                showToast("Alım verileri yüklenirken hata oluştu.", "error");
            });

            // Satışlar koleksiyonunu dinle - Real-time
            const salesQuery = query(collection(db, `artifacts/${appId}/users/${userId}/sales`));
            const unsubscribeSales = onSnapshot(salesQuery, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log('Real-time satışlar güncellendi:', data.length, 'kayıt');
                setSales(data);
            }, (error) => {
                console.error("Satışlar verisi çekilirken hata oluştu:", error);
                showToast("Satış verileri yüklenirken hata oluştu.", "error");
            });

            // İşlemler (gelir/gider) koleksiyonunu dinle
            const transactionsQuery = query(collection(db, `artifacts/${appId}/users/${userId}/transactions`));
            const unsubscribeTransactions = onSnapshot(transactionsQuery, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setTransactions(data);
            }, (error) => {
                console.error("İşlemler verisi çekilirken hata oluştu:", error);
                showToast("İşlem verileri yüklenirken hata oluştu.", "error");
            });

            // Listen to the paymentPlans collection
            const paymentPlansQuery = query(collection(db, `artifacts/${appId}/users/${userId}/paymentPlans`));
            const unsubscribePaymentPlans = onSnapshot(paymentPlansQuery, (snapshot) => {
                const data = {};
                snapshot.docs.forEach(doc => {
                    data[doc.id] = doc.data();
                });
                setPaymentPlans(data);
            }, (error) => {
                console.error("Error fetching payment plans data:", error);
                showToast("Error loading payment plan data.", "error");
            });


            return () => {
                unsubscribePurchases();
                unsubscribeSales();
                unsubscribeTransactions();
                unsubscribePaymentPlans();
            };
        }
    }, [db, userId, showToast]);

    // Firestore'a yeni alım ekleme
    const addPurchase = async (purchaseData) => {
        if (!db || !userId) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/purchases`), purchaseData);
            showToast("Alım başarıyla eklendi!", "success");

            // Eğer zeytin alımı ise, otomatik olarak bir gider işlemi de ekle
            if (purchaseData.itemType === 'Zeytin' && parseFloat(purchaseData.totalPrice || 0) > 0) {
                await addDoc(collection(db, `artifacts/${appId}/users/${userId}/transactions`), {
                    date: purchaseData.date,
                    description: `Zeytin Alım Tutarı: ${purchaseData.quantity} kg (${formatNumber(purchaseData.unitPrice)} TL/kg)`,
                    amount: purchaseData.totalPrice, // Bu artık parasal değer
                    type: 'Gider',
                    category: 'Zeytin Alım Maliyeti',
                    oliveSubtype: purchaseData.oliveSubtype, // FIX: Added oliveSubtype to transaction
                });
                showToast("Zeytin alım maliyeti otomatik olarak eklendi.", "success");
            }

        } catch (e) {
            console.error("Alım eklenirken hata oluştu: ", e);
            showToast("Alım eklenirken hata oluştu.", "error");
        }
    };

    // Firestore'a yeni satış ekleme
    const addSale = async (saleData) => {
        if (!db || !userId) {
            console.error('Firebase bağlantısı eksik:', { db: !!db, userId: !!userId });
            showToast("Firebase bağlantısı eksik.", "error");
            return;
        }
        
        try {
            console.log('Satış verisi kontrol ediliyor:', saleData);
            
            // Veri doğrulama
            if (!saleData.customer || !saleData.date || !saleData.itemType) {
                console.error('Eksik veri:', { customer: !!saleData.customer, date: !!saleData.date, itemType: !!saleData.itemType });
                showToast("Eksik veri: Müşteri, tarih ve ürün tipi gereklidir.", "error");
                return;
            }
            
            // Sayısal değerleri kontrol et
            const numericFields = ['quantity', 'unitPrice', 'totalPrice'];
            for (const field of numericFields) {
                if (saleData[field] !== undefined && (isNaN(saleData[field]) || saleData[field] === '')) {
                    console.error(`Geçersiz sayısal değer: ${field} = ${saleData[field]}`);
                    showToast(`Geçersiz değer: ${field}`, "error");
                    return;
                }
            }
            
            // receivedAmount ve remainingBalance için özel kontrol
            if (saleData.receivedAmount === '' || saleData.receivedAmount === undefined || saleData.receivedAmount === null) {
                saleData.receivedAmount = 0;
            }
            if (saleData.remainingBalance === '' || saleData.remainingBalance === undefined || saleData.remainingBalance === null) {
                saleData.remainingBalance = parseFloat(saleData.totalPrice || 0) - parseFloat(saleData.receivedAmount || 0);
            }
            
            // Sayısal değerleri temizle
            saleData.receivedAmount = parseFloat(saleData.receivedAmount || 0);
            saleData.remainingBalance = parseFloat(saleData.remainingBalance || 0);
            
            // Müşteriyi kontrol et ve gerekirse ekle
            const customerRef = collection(db, `artifacts/${appId}/users/${userId}/customers`);
            const q = query(customerRef, where("name", "==", saleData.customer));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                // Müşteri yoksa ekle
                await addDoc(customerRef, { name: saleData.customer });
                console.log("Yeni müşteri eklendi:", saleData.customer);
            }

            console.log('Firestore\'a satış verisi gönderiliyor...');
            const docRef = await addDoc(collection(db, `artifacts/${appId}/users/${userId}/sales`), saleData);
            console.log('Satış başarıyla eklendi, doc ID:', docRef.id);
            showToast("Satış başarıyla eklendi!", "success");
        } catch (e) {
            console.error("Satış eklenirken hata oluştu: ", e);
            console.error("Hata detayları:", {
                code: e.code,
                message: e.message,
                stack: e.stack
            });
            showToast(`Satış eklenirken hata oluştu: ${e.message}`, "error");
        }
    };

    // Firestore'a yeni işlem (gelir/gider) ekleme
    const addTransaction = async (transactionData) => {
        if (!db || !userId) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/users/${userId}/transactions`), transactionData);
            showToast("İşlem başarıyla eklendi!", "success");
        } catch (e) {
            console.error("İşlem eklenirken hata oluştu: ", e);
            showToast("İşlem eklenirken hata oluştu.", "error");
        }
    };

    // Add/Update payment plan for a specific month
    const setMonthlyPaymentPlan = async (monthKey, data) => {
        if (!db || !userId) {
            console.error('Firebase bağlantısı yok:', { db: !!db, userId: !!userId });
            return;
        }
        try {
            console.log(`${monthKey} ayı Firebase'e kaydediliyor:`, data);
            await setDoc(doc(db, `artifacts/${appId}/users/${userId}/paymentPlans`, monthKey), data, { merge: true });
            console.log(`${monthKey} ayı başarıyla kaydedildi`);
        } catch (e) {
            console.error(`Error saving payment plan for ${monthKey}: `, e);
            // Toast göstermeyi kaldırdık çünkü çok fazla hata olabilir
        }
    };

    // Delete document from Firestore (general function)
    const deleteDocument = async (collectionName, id) => {
        if (!db || !userId) return;

        // Modalı göster ve onay bekle
        setModalContent({
            title: 'Silme Onayı',
            message: 'Bu kaydı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.',
            onConfirm: async () => {
                try {
                    // Modal'ı hemen kapat
                    setShowModal(false);
                    await deleteDoc(doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id));
                    showToast("Belge başarıyla silindi!", "success");
                }  catch (e) {
                    console.error("Belge silinirken hata oluştu: ", e);
                    showToast("Belge silinirken hata oluştu.", "error");
                }
            },
            onCancel: () => setShowModal(false) // Modalı kapat
        });
        setShowModal(true);
    };

    // Update document in Firestore (general function)
    const updateDocument = async (collectionName, id, data) => {
        if (!db || !userId) return;
        try {
            await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/${collectionName}`, id), data);
            showToast("Belge başarıyla güncellendi!", "success");
        } catch (e) {
            console.error("Belge güncellenirken hata oluştu: ", e);
            showToast("Belge güncellenirken hata oluştu.", "error");
        }
    };

    // Login state
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        
        // Gmail ve şifre kontrolü
        const correctEmail = 'uygulamam80@gmail.com';
        const correctPassword = 'Saf.8080';
        
        if (loginEmail === correctEmail && loginPassword === correctPassword) {
            // Firebase Authentication ile giriş yap
            try {
                await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
                setIsLoggedIn(true);
                setLoginError('');
                console.log('Firebase giriş başarılı:', loginEmail);
            } catch (error) {
                console.error('Firebase giriş hatası:', error);
                setLoginError('Giriş yapılırken hata oluştu.');
                setLoginPassword('');
            }
        } else {
            setLoginError('Gmail adresi veya şifre yanlış!');
            setLoginPassword('');
        }
    };

    // Login screen
    if (!isLoggedIn) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="bg-white p-8 rounded-lg shadow-md w-96">
                    <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">Hesap Takip Sistemi</h1>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Gmail Adresi
                            </label>
                            <input
                                type="email"
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Gmail adresinizi girin"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Şifre
                            </label>
                            <input
                                type="password"
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Şifrenizi girin"
                                required
                            />
                        </div>
                        {loginError && (
                            <div className="text-red-500 text-sm text-center">
                                {loginError}
                            </div>
                        )}
                        <button
                            type="submit"
                            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            Giriş Yap
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="flex flex-col items-center">
                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-4"></div>
                    <div className="text-xl font-semibold text-gray-700">Yükleniyor...</div>
                </div>
            </div>
        );
    }

    // Dashboard component
    const Dashboard = () => {
        // Toplam gelir ve gider hesaplaması
        const totalSales = sales.reduce((sum, s) => sum + parseFloat(s.totalPrice || 0), 0);
        const totalOliveAcquisitionCosts = transactions.filter(t => t.category === 'Zeytin Alım Maliyeti').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const otherIncome = transactions.filter(t => t.type === 'Gelir' && t.category !== 'Zeytin Alım Maliyeti').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const otherExpenses = transactions.filter(t => t.type === 'Gider' && t.category !== 'Zeytin Alım Maliyeti').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
        const netBalance = totalSales + otherIncome - totalOliveAcquisitionCosts - otherExpenses;

        // Zeytin stoğu hesaplaması
        const oliveStockBySubtype = purchases.filter(p => p.itemType === 'Zeytin').reduce((acc, p) => {
            const subtype = p.oliveSubtype || 'Belirtilmemiş';
            acc[subtype] = (acc[subtype] || 0) + parseFloat(p.quantity || 0);
            return acc;
        }, {});
        
        sales.filter(s => s.itemType === 'Zeytin').forEach(s => {
            const subtype = s.oliveSubtype || 'Belirtilmemiş';
            oliveStockBySubtype[subtype] = (oliveStockBySubtype[subtype] || 0) - parseFloat(s.quantity || 0);
        });
        
        const oliveStock = Object.values(oliveStockBySubtype).reduce((sum, val) => sum + val, 0);

        const oliveOilStock = purchases.filter(p => p.itemType === 'Zeytinyağı').reduce((sum, p) => sum + parseFloat(p.quantity || 0), 0) -
                                     sales.filter(s => s.itemType === 'Zeytinyağı').reduce((sum, s) => sum + parseFloat(s.quantity || 0), 0);
        const oliveOilCanStock = (oliveOilStock / 16);

        const totalSoldOliveWeight = sales.filter(s => s.itemType === 'Zeytin').reduce((sum, s) => sum + parseFloat(s.quantity || 0), 0);
        
        // Satılan zeytin dağılımı ve toplam tutarları
        const soldOliveData = useMemo(() => {
            const salesBySubtype = sales.filter(s => s.itemType === 'Zeytin').reduce((acc, s) => {
                const subtype = s.oliveSubtype || 'Belirtilmemiş';
                if (!acc[subtype]) {
                    acc[subtype] = { quantity: 0, totalPrice: 0 };
                }
                acc[subtype].quantity += parseFloat(s.quantity || 0);
                acc[subtype].totalPrice += parseFloat(s.totalPrice || 0);
                return acc;
            }, {});

            const orderedSubtypes = ['230-260', '260-290', '290-320', 'Yeşil Zeytin']; // FIX: Added Yeşil Zeytin to orderedSubtypes
            const orderedData = orderedSubtypes.map(subtype => ({
                name: `Kalibre ${subtype}`,
                quantity: salesBySubtype[subtype]?.quantity || 0,
                totalPrice: salesBySubtype[subtype]?.totalPrice || 0,
            }));

            return orderedData;
        }, [sales]);

        // Mevcut zeytin stoğu verileri
        const oliveStockData = useMemo(() => {
            const stockBySubtype = purchases.filter(p => p.itemType === 'Zeytin').reduce((acc, p) => {
                const subtype = p.oliveSubtype || 'Belirtilmemiş';
                acc[subtype] = (acc[subtype] || 0) + parseFloat(p.quantity || 0);
                return acc;
            }, {});
            
            sales.filter(s => s.itemType === 'Zeytin').forEach(s => {
                const subtype = s.oliveSubtype || 'Belirtilmemiş';
                stockBySubtype[subtype] = (stockBySubtype[subtype] || 0) - parseFloat(s.quantity || 0);
            });

            const orderedSubtypes = ['230-260', '260-290', '290-320', 'Yeşil Zeytin']; // FIX: Added Yeşil Zeytin to orderedSubtypes
            const orderedData = orderedSubtypes.map(subtype => ({
                name: `Zeytin Stoğu (${subtype})`,
                quantity: stockBySubtype[subtype] || 0,
            }));
            return orderedData;
        }, [purchases, sales]);
        
        // Zeytinyağı satış ve kar/zarar durumu
        const totalSoldOliveOilCans = sales.filter(s => s.itemType === 'Zeytinyağı').reduce((sum, s) => sum + parseFloat(s.canCount || 0), 0);
        const oliveOilTotalIncome = sales.filter(s => s.itemType === 'Zeytinyağı').reduce((sum, s) => sum + parseFloat(s.totalPrice || 0), 0);
        const oliveOilTotalExpense = purchases.filter(p => p.itemType === 'Zeytinyağı').reduce((sum, p) => sum + parseFloat(p.totalPrice || 0), 0);
        const oliveOilNetProfit = oliveOilTotalIncome - oliveOilTotalExpense;

        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Ana Sayfa</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-blue-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-blue-800 mb-2">Toplam Satış Tutarı</h3>
                        <p className="text-3xl font-bold text-blue-600">{formatNumber(totalSales)} TL</p>
                    </div>
                    <div className="bg-orange-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-orange-800 mb-2">Toplam Maliyetler</h3>
                        <p className="text-3xl font-bold text-orange-600">{formatNumber(totalOliveAcquisitionCosts + otherExpenses)} TL</p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-green-800 mb-2">Kar-Zarar Durumu</h3>
                        <p className="text-3xl font-bold text-green-600">{formatNumber(netBalance)} TL</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Satılan Toplam Zeytin Miktarı Kartı */}
                    <div className="bg-green-50 p-4 rounded-lg shadow-sm"> {/* FIX: Changed background color to green-50 */}
                        <h3 className="text-lg font-semibold text-green-800 mb-2">Satılan Toplam Zeytin Miktarı</h3> {/* FIX: Changed text color to green-800 */}
                        <p className="text-3xl font-bold text-green-600">{formatNumber(totalSoldOliveWeight)} kg</p> {/* FIX: Changed text color to green-600 */}
                        <div className="mt-4 space-y-2">
                            {soldOliveData.map((item, index) => (
                                <div key={index} className="flex justify-between items-center bg-green-200 p-2 rounded-md"> {/* FIX: Changed background color to green-200 */}
                                    <div>
                                        <p className="font-semibold text-green-700">{item.name}</p> {/* FIX: Changed text color to green-700 */}
                                        <p className="text-green-600">{formatNumber(item.quantity)} kg</p> {/* FIX: Changed text color to green-600 */}
                                    </div>
                                    <p className="text-xl font-bold text-green-800">{formatNumber(item.totalPrice)} TL</p> {/* FIX: Changed text color to green-800 */}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Mevcut Stok Durumu Kartları */}
                    <div className="bg-green-50 p-4 rounded-lg shadow-sm"> {/* FIX: Changed background color to green-50 */}
                        <h3 className="text-lg font-semibold text-green-800 mb-2">Mevcut Stok Durumu</h3> {/* FIX: Changed text color to green-800 */}
                        <p className="text-3xl font-bold text-green-600">{formatNumber(oliveStock)} kg</p> {/* FIX: Changed text color to green-600 */}
                        <div className="mt-4 space-y-2">
                            {oliveStockData.map((item, index) => (
                                <div key={index} className="flex justify-between items-center bg-green-200 p-2 rounded-md"> {/* FIX: Changed background color to green-200 */}
                                    <p className="font-semibold text-green-700">{item.name}</p> {/* FIX: Changed text color to green-700 */}
                                    <p className="text-xl font-bold text-green-800">{formatNumber(item.quantity)} kg</p> {/* FIX: Changed text color to green-800 */}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Zeytinyağı Stoğu ve Kar/Zarar Durumu */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-gray-100 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Toplam Zeytinyağı Stoğu</h3>
                        <p className="text-3xl font-bold text-gray-600">{formatNumber(oliveOilCanStock)} teneke</p>
                    </div>
                    <div className="bg-gray-100 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-gray-800 mb-2">Satılan Zeytinyağı Teneke Sayısı</h3>
                        <p className="text-3xl font-bold text-gray-600">{formatNumber(totalSoldOliveOilCans)} teneke</p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-green-800 mb-2">Zeytinyağı Net Kar/Zarar</h3>
                        <p className="text-3xl font-bold text-green-600">{formatNumber(oliveOilNetProfit)} TL</p>
                    </div>
                </div>
            </div>
        );
    };

    // Form and Table common components
    const FormInput = ({ label, type = 'text', name, value, onChange, options = [], readOnly = false, required = false, className = '' }) => {
        return (
            <div className={`mb-4 ${className}`}>
                <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">
                    {label} {required && <span className="text-red-500">*</span>}
                </label>
                {type === 'select' ? (
                    <select
                        id={name}
                        name={name}
                        value={value}
                        onChange={onChange}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        readOnly={readOnly}
                        disabled={readOnly}
                        required={required}
                    >
                        {options.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                ) : (
                    <input
                        type={type}
                        id={name}
                        name={name}
                        value={value}
                        onChange={onChange}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        readOnly={readOnly}
                        required={required}
                    />
                )}
            </div>
        );
    };

    const Table = ({ data, columns, onDelete, onEdit, collectionName, transactionLimit, setTransactionLimit, exportData, isXLSXLoaded }) => (
        <div className="overflow-x-auto mt-6 rounded-lg shadow-sm border border-gray-200">
            {exportData && (
                <div className="flex justify-end p-4">
                    <button
                        onClick={exportData}
                        className={`px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${!isXLSXLoaded ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-700'}`}
                        disabled={!isXLSXLoaded} // FIX: Disable button if XLSX is not loaded
                    >
                        Excel'e Aktar
                    </button>
                </div>
            )}
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50"><tr>
                    {columns.map((col, index) => (
                        <th key={index} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{col.header}</th>
                    ))}
                    {(onDelete || onEdit) && (
                        <th scope="col" className="relative px-6 py-3"><span className="sr-only">İşlemler</span></th>
                    )}
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.length === 0 ? (
                        <tr><td colSpan={columns.length + (onDelete || onEdit ? 1 : 0)} className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">Kayıt bulunamadı.</td></tr>
                    ) : (
                        data.slice(0, transactionLimit === Infinity ? data.length : transactionLimit).map((row) => (
                            <tr key={row.id}>{columns.map((col, index) => (<td key={index} className="px-6 py-2 whitespace-nowrap text-sm text-gray-900">{col.render ? col.render(row) : row[col.field]}</td>))}
                                {(onDelete || onEdit) && (<td className="px-6 py-2 whitespace-nowrap text-right text-sm font-medium">
                                    {onEdit && (<button onClick={() => onEdit(row)} className="text-indigo-600 hover:text-indigo-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 rounded-md mr-2">Düzenle</button>)}
                                    {onDelete && (<button onClick={() => onDelete(collectionName, row.id)} className="text-red-600 hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-md">Sil</button>)}
                                </td>)}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
            {setTransactionLimit && (
                <div className="mt-4 flex justify-center space-x-2">
                    <button
                        onClick={() => setTransactionLimit(5)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 5 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 5
                    </button>
                    <button
                        onClick={() => setTransactionLimit(10)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 10 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 10
                    </button>
                    <button
                        onClick={() => setTransactionLimit(20)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 20 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 20
                    </button>
                    <button
                        onClick={() => setTransactionLimit(50)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 50 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 50
                    </button>
                    <button
                        onClick={() => setTransactionLimit(Infinity)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === Infinity ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Tümü
                    </button>
                </div>
            )}
        </div>
    );

    // Common Item Form Component (for Purchase and Sale)
    const ItemForm = ({ itemType, title, onSubmit, currentData, deleteDocument, updateDocument, collectionName, searchPlaceholder, onSearchChange, searchTerm, exportData, isXLSXLoaded }) => {
        const initialItemState = {
            date: '',
            itemType: itemType,
            quantity: '',
            unitPrice: '',
            totalPrice: '',
            supplier: '',
            customer: '',
            receivedAmount: '',
            remainingBalance: '',
            oliveSubtype: itemType === 'Zeytin' ? '230-260' : '',
            canType: itemType === 'Zeytinyağı' ? '16' : '',
            canCount: '',
        };
        const [newItem, setNewItem] = useState(initialItemState);
        const [editingItem, setEditingItem] = useState(null);
        const [tableLimit, setTableLimit] = useState(10);
        const [isSubmitting, setIsSubmitting] = useState(false);

        useEffect(() => {
            if (itemType === 'Zeytinyağı') {
                const canCount = parseFloat(newItem.canCount || 0);
                const canSize = parseFloat(newItem.canType || 0);
                const calculatedQuantity = canCount * canSize;
                setNewItem(prev => ({ ...prev, quantity: calculatedQuantity.toFixed(0) }));

                const unitPrice = parseFloat(newItem.unitPrice || 0);
                if (!isNaN(canCount) && !isNaN(unitPrice)) {
                    setNewItem(prev => ({ ...prev, totalPrice: (canCount * unitPrice).toFixed(0) }));
                } else {
                    setNewItem(prev => ({ ...prev, totalPrice: '' }));
                }
            } else if (itemType === 'Zeytin') {
                const quantity = parseFloat(newItem.quantity || 0);
                const unitPrice = parseFloat(newItem.unitPrice || 0);
                if (!isNaN(quantity) && !isNaN(unitPrice)) {
                    setNewItem(prev => ({ ...prev, totalPrice: (quantity * unitPrice).toFixed(0) }));
                } else {
                    setNewItem(prev => ({ ...prev, totalPrice: '' }));
                }
            }
        }, [newItem.quantity, newItem.unitPrice, newItem.canCount, newItem.canType, itemType]);

        useEffect(() => {
            if (itemType === 'Zeytin' || itemType === 'Zeytinyağı') {
                const total = parseFloat(newItem.totalPrice || 0);
                const received = parseFloat(newItem.receivedAmount || 0);
                const balance = total - received;
                setNewItem(prev => ({ ...prev, remainingBalance: balance.toFixed(0) }));
            }
        }, [newItem.totalPrice, newItem.receivedAmount, itemType]);


        const handleChange = (e) => {
            const { name, value } = e.target;
            setNewItem(prev => ({ ...prev, [name]: value }));
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            
            // Eğer zaten submit işlemi devam ediyorsa, yeni submit'i engelle
            if (isSubmitting) {
                console.log('Submit işlemi zaten devam ediyor, yeni submit engellendi');
                return;
            }
            
            console.log('Submit işlemi başlatılıyor...');
            console.log('Gönderilecek veri:', newItem);
            setIsSubmitting(true);
            
            try {
                const dataToSave = { ...newItem };
                console.log('İşlenecek veri:', dataToSave);

                if (editingItem) {
                    console.log('Güncelleme işlemi başlatılıyor...');
                    await updateDocument(collectionName, editingItem.id, dataToSave);
                    if (itemType === 'Zeytin' && collectionName === 'purchases') {
                        const oldDescription = `Zeytin Alım Tutarı: ${editingItem.quantity} kg (${formatNumber(editingItem.unitPrice)} TL/kg)`;
                        const relatedTransactionQuery = query(
                            collection(db, `artifacts/${appId}/users/${userId}/transactions`),
                            where('category', '==', 'Zeytin Alım Maliyeti'),
                            where('description', '==', oldDescription)
                        );
                        const querySnapshot = await getDocs(relatedTransactionQuery);
                        if (!querySnapshot.empty) {
                            const transactionDoc = querySnapshot.docs[0];
                            await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/transactions`, transactionDoc.id), {
                                date: dataToSave.date,
                                description: `Zeytin Alım Tutarı: ${dataToSave.quantity} kg (${formatNumber(dataToSave.unitPrice)} TL/kg)`,
                                amount: dataToSave.totalPrice,
                            });
                            showToast("Olive acquisition cost automatically updated.", "success");
                        }
                    }
                    setEditingItem(null);
                } else {
                    console.log('Yeni kayıt ekleme işlemi başlatılıyor...');
                    await onSubmit(dataToSave);
                }
                setNewItem(initialItemState);
                console.log('Submit işlemi başarıyla tamamlandı');
            } catch (error) {
                console.error('Submit işlemi sırasında hata:', error);
                console.error('Hata detayları:', {
                    code: error.code,
                    message: error.message,
                    stack: error.stack
                });
                showToast(`İşlem sırasında hata oluştu: ${error.message}`, "error");
            } finally {
                setIsSubmitting(false);
                console.log('Submit işlemi tamamlandı, isSubmitting false yapıldı');
            }
        };

        const handleEdit = (item) => {
            setEditingItem(item);
            setNewItem({
                ...item,
                canType: item.itemType === 'Zeytinyağı' ? (item.canType || '16') : '',
                canCount: item.itemType === 'Zeytinyağı' ? (item.canCount || '') : '',
                unitPrice: item.unitPrice || '',
            });
        };

        const handleCancelEdit = () => {
            setEditingItem(null);
            setNewItem(initialItemState);
        };

        const getColumns = () => {
            const commonColumns = [
                { header: 'Tarih', field: 'date' },
            ];

            let specificColumns = [];
            if (collectionName === 'purchases') {
                if (itemType === 'Zeytinyağı') {
                    specificColumns.push({ header: 'Tedarikçi', field: 'supplier' });
                    specificColumns.push({ header: 'Teneke', field: 'canType', render: (row) => `${row.canCount} x ${row.canType}lt` });
                    specificColumns.push({ header: 'Miktar(lt)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} lt` });
                    specificColumns.push({ header: 'Birim F.', field: 'unitPrice', render: (row) => `${formatNumber(row.unitPrice)} TL` });
                    specificColumns.push({ header: 'Toplam F.', field: 'totalPrice', render: (row) => `${formatNumber(row.totalPrice)} TL` });
                } else if (itemType === 'Zeytin') {
                    specificColumns.push({ header: 'Kalibre', field: 'oliveSubtype' });
                    specificColumns.push({ header: 'Miktar(kg)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} kg` });
                }
            } else if (collectionName === 'sales') {
                specificColumns.push({ header: 'Müşteri', field: 'customer' });
                if (itemType === 'Zeytin') {
                    specificColumns.push({ header: 'Kalibre', field: 'oliveSubtype' });
                } else if (itemType === 'Zeytinyağı') {
                    specificColumns.push({ header: 'Teneke', field: 'canType', render: (row) => `${row.canCount} x ${row.canType}lt` });
                }
                specificColumns.push({ header: 'Miktar', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} ${row.itemType === 'Zeytin' ? 'kg' : 'lt'}` });
                specificColumns.push({ header: 'Birim F.', field: 'unitPrice', render: (row) => `${formatNumber(row.unitPrice)} TL` });
                specificColumns.push({ header: 'Toplam F.', field: 'totalPrice', render: (row) => `${formatNumber(row.totalPrice)} TL` });
                specificColumns.push({ header: 'Alınan Öd.', field: 'receivedAmount', render: (row) => `${formatNumber(row.receivedAmount)} TL` });
                specificColumns.push({ header: 'Kalan Bak.', field: 'remainingBalance', render: (row) => `${formatNumber(row.remainingBalance)} TL` });
            }
            return [...commonColumns, ...specificColumns];
        };

        const filteredData = currentData.filter(item => {
            const matchesItemType = item.itemType === itemType;
            const matchesSearchTerm = (item.supplier || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                     (item.customer || '').toLowerCase().includes(searchTerm.toLowerCase());
            return matchesItemType && matchesSearchTerm;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        // Function to export data to Excel
        const exportToExcel = () => {
            if (!isXLSXLoaded) { // FIX: Use isXLSXLoaded state
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            // FIX: Use the generic exportDataToExcel utility
            exportDataToExcel(filteredData, getColumns(), title, showToast);
        };

        return (
            <div className="p-6 bg-white rounded-lg shadow-md mb-8">
                <h3 className="text-xl font-bold text-gray-800 mb-4">{title}</h3>
                {title.includes('Alımı') && itemType === 'Zeytin' ? null : (
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <FormInput label="Tarih" type="date" name="date" value={newItem.date} onChange={handleChange} />
                        {itemType === 'Zeytinyağı' && collectionName === 'purchases' && (
                            <FormInput label="Tedarikçi" name="supplier" value={newItem.supplier} onChange={handleChange} />
                        )}
                        {(itemType === 'Zeytin' || itemType === 'Zeytinyağı') && collectionName === 'sales' && (
                            <FormInput label="Müşteri" name="customer" value={newItem.customer} onChange={handleChange} />
                        )}

                        {itemType === 'Zeytin' && (
                            <FormInput
                                label="Zeytin Kalibresi"
                                type="select"
                                name="oliveSubtype"
                                value={newItem.oliveSubtype}
                                onChange={handleChange}
                                options={[
                                    { value: '230-260', label: '230-260' },
                                    { value: '260-290', label: '260-290' },
                                    { value: '290-320', label: '290-320' },
                                    { value: 'Yeşil Zeytin', label: 'Yeşil Zeytin' }, // FIX: Added Yeşil Zeytin
                                ]}
                            />
                        )}

                        {itemType === 'Zeytinyağı' ? (
                            <>
                                <FormInput
                                    label="Teneke Tipi"
                                    type="select"
                                    name="canType"
                                    value={newItem.canType}
                                    onChange={handleChange}
                                    options={[
                                        { value: '16', label: '16\'lık Teneke' },
                                        { value: '5', label: '5\'lik Teneke' },
                                    ]}
                                />
                                <FormInput label="Teneke Sayısı" type="number" name="canCount" value={newItem.canCount} onChange={handleChange} />
                                <FormInput label="Toplam Miktar (Litre)" type="text" name="quantityDisplay" value={formatNumber(newItem.quantity)} readOnly={true} />
                                <FormInput label="Birim Fiyat (Teneke Başına)" type="number" name="unitPrice" value={newItem.unitPrice} onChange={handleChange} />
                            </>
                        ) : (
                            <>
                                <FormInput label="Miktar (kg)" type="number" name="quantity" value={newItem.quantity} onChange={handleChange} />
                                <FormInput label="Birim Fiyat (kg Başına)" type="number" name="unitPrice" value={newItem.unitPrice} onChange={handleChange} className={collectionName === 'purchases' ? 'hidden' : ''} />
                            </>
                        )}

                        <FormInput
                            label="Toplam Fiyat"
                            type="number"
                            name="totalPrice"
                            value={newItem.totalPrice}
                            onChange={handleChange}
                            readOnly={true}
                            className={itemType === 'Zeytin' && collectionName === 'purchases' ? 'hidden' : ''}
                        />

                        {(itemType === 'Zeytin' || itemType === 'Zeytinyağı') && collectionName === 'sales' && (
                            <>
                                <FormInput label="Alınan Ödeme Tutarı" type="number" name="receivedAmount" value={newItem.receivedAmount} onChange={handleChange} />
                                <FormInput label="Kalan Bakiye Tutarı" type="number" name="remainingBalance" value={newItem.remainingBalance} readOnly={true} />
                            </>
                        )}

                        <div className="md:col-span-2 lg:col-span-3 flex justify-end space-x-2">
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={`px-6 py-2 font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                                    isSubmitting 
                                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed' 
                                        : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500'
                                }`}
                            >
                                {isSubmitting ? 'İşleniyor...' : (editingItem ? 'Güncelle' : 'Ekle')}
                            </button>
                            {editingItem && (
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="px-6 py-2 bg-gray-400 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                                >
                                    İptal
                                </button>
                            )}
                        </div>
                    </form>
                )}


                <h4 className="text-lg font-semibold text-gray-800 mt-8 mb-4">Geçmiş {title.replace('Alımı', 'Alımları').replace('Satışı', 'Satışları')}</h4>
                {searchPlaceholder && (
                    <div className="mb-4">
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchTerm}
                            onChange={onSearchChange}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                    </div>
                )}
                <Table data={filteredData} columns={getColumns()} onDelete={deleteDocument} onEdit={handleEdit} collectionName={collectionName} transactionLimit={tableLimit} setTableLimit={setTableLimit} exportData={exportToExcel} isXLSXLoaded={isXLSXLoaded} />
            </div>
        );
    };

    // Olive Acquisition Costs Component
    const OliveAcquisitionCosts = ({ addTransaction, transactions, deleteDocument, updateDocument, isXLSXLoaded }) => {
        const initialCostState = {
            date: '',
            costCategory: 'Zeytin Alım Tutarı',
            amount: '',
            description: '',
            type: 'Gider',
            category: 'Zeytin Alım Maliyeti',
        };
        const [newCost, setNewCost] = useState(initialCostState);
        const [editingCost, setEditingCost] = useState(null);
        const [tableLimit, setTableLimit] = useState(10);

        const handleChange = (e) => {
            const { name, value } = e.target;
            setNewCost(prev => ({ ...prev, [name]: value }));
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            const dataToSave = {
                ...newCost,
                amount: parseFloat(newCost.amount || 0).toFixed(0),
                description: `${newCost.costCategory}: ${newCost.description}`,
            };

            if (editingCost) {
                await updateDocument('transactions', editingCost.id, dataToSave);
                setEditingCost(null);
            } else {
                await addTransaction(dataToSave);
            }
            setNewCost(initialCostState);
        };

        const handleEdit = (cost) => {
            setEditingCost(cost);
            const [categoryPart, ...descriptionParts] = cost.description.split(':');
            setNewCost({
                ...cost,
                costCategory: categoryPart.trim() || 'Zeytin Alım Tutarı',
                amount: cost.amount || '',
                description: descriptionParts.join(':').trim() || '',
            });
        };

        const handleCancelEdit = () => {
            setEditingCost(null);
            setNewCost(initialCostState);
        };

        const columns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Maliyet Kalemi', field: 'costCategory', render: (row) => row.description.split(':')[0] || 'N/A' },
            { header: 'Açıklama', field: 'description', render: (row) => row.description.split(':')[1] || '' },
            { header: 'Tutar', field: 'amount', render: (row) => `${formatNumber(row.amount)} TL` },
        ];
        
        const filteredCosts = transactions.filter(t => t.category === 'Zeytin Alım Maliyeti').sort((a, b) => new Date(b.date) - new Date(a.date));
        const totalCosts = filteredCosts.reduce((sum, cost) => sum + parseFloat(cost.amount || 0), 0); // FIX: totalCosts defined here
        // FIX: Include 'Yeşil Zeytin Maliyeti' in totalOlivePurchaseAmount
        const totalOlivePurchaseAmount = filteredCosts.filter(t => t.costCategory === 'Zeytin Alım Tutarı' || t.costCategory === 'Yeşil Zeytin Maliyeti').reduce((sum, cost) => sum + parseFloat(cost.amount || 0), 0);
        const otherCosts = totalCosts - totalOlivePurchaseAmount;
        
        // Function to export data to Excel
        const exportToExcel = () => {
            if (!isXLSXLoaded) { // FIX: Use isXLSXLoaded state
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            // FIX: Use the generic exportDataToExcel utility
            exportDataToExcel(filteredCosts, columns, "Zeytin Maliyetleri", showToast);
        };

        return (
            <div className="p-6 bg-white rounded-lg shadow-md mt-8">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Zeytin Alım Maliyetleri</h3>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <FormInput label="Tarih" type="date" name="date" value={newCost.date} onChange={handleChange} required />
                    <FormInput
                        label="Maliyet Kalemi"
                        type="select"
                        name="costCategory"
                        value={newCost.costCategory}
                        onChange={handleChange}
                        options={[
                            { value: 'Zeytin Alım Tutarı', label: 'Zeytin Alım Tutarı' },
                            { value: 'Teneke Alım Gideri', label: 'Teneke Alım Gideri' },
                            { value: 'İşçilik Gideri', label: 'İşçilik Gideri' },
                            { value: 'Muhtelif Giderler', label: 'Muhtelif Giderler' },
                            { value: 'Yeşil Zeytin Maliyeti', label: 'Yeşil Zeytin Maliyeti' }, // FIX: Added Yeşil Zeytin Maliyeti
                        ]}
                    />
                    <FormInput label="Tutar" type="number" name="amount" value={newCost.amount} onChange={handleChange} required />
                    <FormInput label="Açıklama" type="text" name="description" value={newCost.description} onChange={handleChange} className="lg:col-span-3" />
                    <div className="md:col-span-2 lg:col-span-3 flex justify-end space-x-2">
                        <button
                            type="submit"
                            className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-md shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                        >
                            {editingCost ? 'Maliyeti Güncelle' : 'Maliyet Ekle'}
                        </button>
                        {editingCost && (
                            <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-6 py-2 bg-gray-400 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                                >
                                İptal
                            </button>
                        )}
                    </div>
                </form>
                <h4 className="text-lg font-semibold text-gray-800 mt-8 mb-4">Geçmiş Zeytin Alım Maliyetleri</h4>
                <Table data={filteredCosts} columns={columns} onDelete={deleteDocument} onEdit={handleEdit} collectionName="transactions" transactionLimit={tableLimit} setTableLimit={setTableLimit} exportData={exportToExcel} isXLSXLoaded={isXLSXLoaded} />

                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-blue-50 rounded-lg shadow-sm">
                    <div className="text-left">
                        <h4 className="text-lg font-semibold text-blue-800">Toplam Zeytin Alım Tutarı:</h4>
                        <p className="text-2xl font-bold text-blue-600">{formatNumber(totalOlivePurchaseAmount)} TL</p>
                    </div>
                    <div className="text-center">
                        <h4 className="text-lg font-semibold text-blue-800">Diğer Maliyetler:</h4>
                        <p className="text-2xl font-bold text-blue-600">{formatNumber(otherCosts)} TL</p>
                    </div>
                    <div className="text-right">
                        <h4 className="text-lg font-semibold text-blue-800">Toplam Maliyet:</h4>
                        <p className="text-2xl font-bold text-blue-600">{formatNumber(totalCosts)} TL</p>
                    </div>
                </div>
            </div>
        );
    };


    // Zeytin İşlemleri Sayfası
    const OliveTransactionsPage = () => {
        const [olivePurchaseSearchTerm, setOlivePurchaseSearchTerm] = useState('');
        const [oliveSaleSearchTerm, setOliveSaleSearchTerm] = useState('');
        const filteredSales = sales.filter(item => item.itemType === 'Zeytin').sort((a, b) => new Date(b.date) - new Date(a.date));
        const filteredPurchases = purchases.filter(item => item.itemType === 'Zeytin').sort((a, b) => new Date(b.date) - new Date(a.date));

        const salesColumns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Müşteri', field: 'customer' },
            { header: 'Zeytin Kalibresi', field: 'oliveSubtype' },
            { header: 'Miktar (kg)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} kg` },
            { header: 'Birim Fiyat (kg)', field: 'unitPrice', render: (row) => `${formatNumber(row.unitPrice)} TL` },
            { header: 'Toplam Fiyat', field: 'totalPrice', render: (row) => `${formatNumber(row.totalPrice)} TL` },
            { header: 'Alınan Ödeme', field: 'receivedAmount', render: (row) => `${formatNumber(row.receivedAmount)} TL` },
            { header: 'Kalan Bakiye', field: 'remainingBalance', render: (row) => `${formatNumber(row.remainingBalance)} TL` },
        ];

        const purchasesColumns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Zeytin Kalibresi', field: 'oliveSubtype' },
            { header: 'Miktar (kg)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} kg` },
        ];

        const exportSalesToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredSales, salesColumns, "Zeytin Satışları", showToast);
        };

        const exportPurchasesToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredPurchases, purchasesColumns, "Zeytin Alımları", showToast);
        };


        return (
            <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Zeytin Stok ve Satış İşlemleri</h2>
                <ItemForm
                    itemType="Zeytin"
                    title="Zeytin Satışı"
                    onSubmit={addSale}
                    currentData={sales}
                    deleteDocument={deleteDocument}
                    updateDocument={updateDocument}
                    collectionName="sales"
                    searchPlaceholder="Müşteri Ara..."
                    onSearchChange={(e) => setOliveSaleSearchTerm(e.target.value)}
                    searchTerm={oliveSaleSearchTerm}
                    exportData={exportSalesToExcel} // Export Sales button
                    isXLSXLoaded={isXLSXLoaded} // Pass loading status
                />
                <ItemForm
                    itemType="Zeytin"
                    title="Zeytin Stok Girişi"
                    onSubmit={addPurchase}
                    currentData={purchases}
                    deleteDocument={deleteDocument}
                    updateDocument={updateDocument}
                    collectionName="purchases"
                    searchPlaceholder="Tedarikçi Ara..."
                    onSearchChange={(e) => setOlivePurchaseSearchTerm(e.target.value)}
                    searchTerm={olivePurchaseSearchTerm}
                    exportData={exportPurchasesToExcel} // Export Purchases button
                    isXLSXLoaded={isXLSXLoaded} // Pass loading status
                />
                <OliveAcquisitionCosts addTransaction={addTransaction} transactions={transactions} deleteDocument={deleteDocument} updateDocument={updateDocument} isXLSXLoaded={isXLSXLoaded} />
            </div>
        );
    };

    // Zeytinyağı İşlemleri Sayfası
    const OliveOilTransactionsPage = () => {
        const [stockUnitPrice, setStockUnitPrice] = useState('');
        const [oliveOilPurchaseSearchTerm, setOliveOilPurchaseSearchTerm] = useState('');
        const [oliveOilSaleSearchTerm, setOliveOilSaleSearchTerm] = useState('');

        const oliveOilStock = purchases.filter(p => p.itemType === 'Zeytinyağı').reduce((sum, p) => sum + parseFloat(p.quantity || 0), 0) -
                                     sales.filter(s => s.itemType === 'Zeytinyağı').reduce((sum, s) => sum + parseFloat(s.quantity || 0), 0);
        const oliveOilCanStock = (oliveOilStock / 16);
        
        const monetaryValue = oliveOilCanStock * parseFloat(stockUnitPrice || 0);

        const oliveOilTotalIncome = sales.filter(s => s.itemType === 'Zeytinyağı').reduce((sum, s) => sum + parseFloat(s.totalPrice || 0), 0);
        const oliveOilTotalExpense = purchases.filter(p => p.itemType === 'Zeytinyağı').reduce((sum, p) => sum + parseFloat(p.totalPrice || 0), 0);
        
        // FIX: The calculation for oliveOilNetProfit has been updated as requested.
        const oliveOilNetProfit = (oliveOilTotalIncome - oliveOilTotalExpense) + monetaryValue;

        const salesColumns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Müşteri', field: 'customer' },
            { header: 'Teneke', field: 'canType', render: (row) => `${row.canCount} x ${row.canType}lt` },
            { header: 'Miktar (lt)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} lt` },
            { header: 'Birim Fiyat (Teneke)', field: 'unitPrice', render: (row) => `${formatNumber(row.unitPrice)} TL` },
            { header: 'Toplam Fiyat', field: 'totalPrice', render: (row) => `${formatNumber(row.totalPrice)} TL` },
            { header: 'Alınan Ödeme', field: 'receivedAmount', render: (row) => `${formatNumber(row.receivedAmount)} TL` },
            { header: 'Kalan Bakiye', field: 'remainingBalance', render: (row) => `${formatNumber(row.remainingBalance)} TL` },
        ];
        const purchasesColumns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Tedarikçi', field: 'supplier' },
            { header: 'Teneke', field: 'canType', render: (row) => `${row.canCount} x ${row.canType}lt` },
            { header: 'Miktar (lt)', field: 'quantity', render: (row) => `${formatNumber(row.quantity)} lt` },
            { header: 'Birim Fiyat (Teneke)', field: 'unitPrice', render: (row) => `${formatNumber(row.unitPrice)} TL` },
            { header: 'Toplam Fiyat', field: 'totalPrice', render: (row) => `${formatNumber(row.totalPrice)} TL` },
        ];


        const exportSalesToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredSales, salesColumns, "Zeytinyağı Satışları", showToast);
        };

        const exportPurchasesToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredPurchases, purchasesColumns, "Zeytinyağı Alımları", showToast);
        };

        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Zeytinyağı Alım ve Satış İşlemleri</h2>
                <ItemForm
                    itemType="Zeytinyağı"
                    title="Zeytinyağı Satış"
                    onSubmit={addSale}
                    currentData={sales}
                    deleteDocument={deleteDocument}
                    updateDocument={updateDocument}
                    collectionName="sales"
                    searchPlaceholder="Müşteri Ara..."
                    onSearchChange={(e) => setOliveOilSaleSearchTerm(e.target.value)}
                    searchTerm={oliveOilSaleSearchTerm}
                    exportData={exportSalesToExcel} // Export Sales button
                    isXLSXLoaded={isXLSXLoaded} // Pass loading status
                />
                <ItemForm
                    itemType="Zeytinyağı"
                    title="Zeytinyağı Alım"
                    onSubmit={addPurchase}
                    currentData={purchases}
                    deleteDocument={deleteDocument}
                    updateDocument={updateDocument}
                    collectionName="purchases"
                    searchPlaceholder="Tedarikçi Ara..."
                    onSearchChange={(e) => setOliveOilPurchaseSearchTerm(e.target.value)}
                    searchTerm={oliveOilPurchaseSearchTerm}
                    exportData={exportPurchasesToExcel} // Export Purchases button
                    isXLSXLoaded={isXLSXLoaded} // Pass loading status
                />

                <div className="p-6 bg-white rounded-lg shadow-md mt-8">
                    <h3 className="text-xl font-bold text-gray-800 mb-4">Zeytinyağı Stok Durumu ve Kar/Zarar</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-purple-50 p-4 rounded-lg shadow-sm">
                            <h4 className="text-lg font-semibold text-purple-800 mb-2">Kalan Zeytinyağı Stoğu</h4>
                            <p className="text-3xl font-bold text-purple-600">{formatNumber(oliveOilCanStock)} teneke</p>
                        </div>
                        <div className="bg-purple-50 p-4 rounded-lg shadow-sm">
                            <FormInput
                                label="Kalan Stok Birim Fiyatı (Teneke Başına)"
                                type="number"
                                name="stockUnitPrice"
                                value={stockUnitPrice}
                                onChange={(e) => setStockUnitPrice(e.target.value)}
                            />
                            <h4 className="text-lg font-semibold text-purple-800 mb-2">Kalan Stok Parasal Değeri</h4>
                            <p className="text-3xl font-bold text-purple-600">{formatNumber(monetaryValue)} TL</p>
                        </div>
                        <div className="bg-green-50 p-4 rounded-lg shadow-sm">
                            <h4 className="text-lg font-semibold text-green-800 mb-2">Zeytinyağı Net Kar/Zarar</h4>
                            <p className="text-3xl font-bold text-green-600">{formatNumber(oliveOilNetProfit)} TL</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // Our Customers component
    const CustomersPage = () => {
        const [searchTerm, setSearchTerm] = useState('');
        const [filterType, setFilterType] = useState('all'); // 'all', 'debtors', 'non-debtors'
        const [customerLimit, setCustomerLimit] = useState(10); // FIX: Added state for customer list limit
        const [showCollectModal, setShowCollectModal] = useState(false);
        const [currentCustomerForCollection, setCurrentCustomerForCollection] = useState(null);
        const [showTransactionModal, setShowTransactionModal] = useState(false);
        const [selectedCustomerTransactions, setSelectedCustomerTransactions] = useState([]);
        const [transactionModalTitle, setTransactionModalTitle] = useState('');
        const [collectionAmount, setCollectionAmount] = useState('');
        
        const salesByCustomer = sales.reduce((acc, sale) => {
            if (!acc[sale.customer]) {
                acc[sale.customer] = [];
            }
            acc[sale.customer].push(sale);
            return acc;
        }, {});

        let customerDebts = Object.keys(salesByCustomer).map(customerName => {
            const totalDebt = salesByCustomer[customerName].reduce((sum, sale) => sum + parseFloat(sale.remainingBalance || 0), 0);
            const sortedTransactions = [...salesByCustomer[customerName]].sort((a, b) => new Date(b.date) - new Date(a.date));
            return { name: customerName, totalDebt, transactions: sortedTransactions };
        }).sort((a, b) => {
            const latestDateA = a.transactions.length > 0 ? new Date(a.transactions[0].date) : new Date(0);
            const latestDateB = b.transactions.length > 0 ? new Date(b.transactions[0].date) : new Date(0);
            return latestDateB - latestDateA;
        });

        customerDebts = customerDebts.filter(customer =>
            (customer.name || '').toLowerCase().includes(searchTerm.toLowerCase())
        );

        if (filterType === 'debtors') {
            customerDebts = customerDebts.filter(customer => customer.totalDebt > 0);
        } else if (filterType === 'non-debtors') {
            customerDebts = customerDebts.filter(customer => customer.totalDebt <= 0);
        }

        const totalDebtorsAmount = customerDebts.filter(customer => customer.totalDebt > 0).reduce((sum, customer) => sum + parseFloat(customer.totalDebt || 0), 0);
        const totalSalesAmount = sales.reduce((sum, sale) => sum + parseFloat(sale.totalPrice || 0), 0);
        const totalReceivedPayments = sales.reduce((sum, sale) => sum + parseFloat(sale.receivedAmount || 0), 0);

        const customerTableColumns = [
            { header: 'Müşteri Adı', field: 'name' },
            { header: 'Toplam Borç', field: 'totalDebt', render: (row) => `${formatNumber(row.totalDebt)} TL` },
        ];

        const exportCustomersToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(customerDebts, customerTableColumns, "Müşteriler", showToast);
        };

        const handleCollectPayment = async () => {
            if (!currentCustomerForCollection || !collectionAmount || isNaN(parseFloat(collectionAmount))) {
                showToast("Lütfen geçerli bir tahsilat miktarı girin.", "error");
                return;
            }

            let amountToDeduct = parseFloat(collectionAmount);
            const customerName = currentCustomerForCollection.name;

            try {
                const customerSales = sales.filter(s => s.customer === customerName)
                                            .sort((a, b) => new Date(a.date) - new Date(b.date));

                for (const sale of customerSales) {
                    if (amountToDeduct <= 0) break;

                    if (sale.remainingBalance > 0) {
                        const deductibleAmount = Math.min(amountToDeduct, sale.remainingBalance);
                        const updatedReceivedAmount = parseFloat(sale.receivedAmount || 0) + deductibleAmount;
                        const updatedRemainingBalance = sale.remainingBalance - deductibleAmount;

                        await updateDoc(doc(db, `artifacts/${appId}/users/${userId}/sales`, sale.id), {
                            receivedAmount: updatedReceivedAmount.toFixed(0),
                            remainingBalance: updatedRemainingBalance.toFixed(0),
                        });
                        amountToDeduct -= deductibleAmount;
                    }
                }
                showToast(`${formatNumber(parseFloat(collectionAmount))} TL tahsilat başarıyla yapıldı!`, "success");
            } catch (error) {
                console.error("Tahsilat yapılırken hata oluştu:", error);
                showToast("Tahsilat yapılırken hata oluştu.", "error");
            } finally {
                setShowCollectModal(false);
                setCollectionAmount('');
                setCurrentCustomerForCollection(null);
            }
        };

        const handleCustomerClick = (customer) => {
            setSelectedCustomerTransactions(customer.transactions);
            setTransactionModalTitle(`${customer.name} İşlem Geçmişi`);
            setShowTransactionModal(true);
        };


        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Müşterilerimiz</h2>
        
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-blue-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-blue-800 mb-2">Toplam Satış Tutarı</h3>
                        <p className="text-3xl font-bold text-blue-600">{formatNumber(totalSalesAmount)} TL</p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-purple-800 mb-2">Toplam Alınan Ödeme</h3>
                        <p className="text-3xl font-bold text-purple-600">{formatNumber(totalReceivedPayments)} TL</p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-lg shadow-sm">
                        <h3 className="text-lg font-semibold text-red-800 mb-2">Toplam Alacak Tutarı</h3>
                        <p className="text-3xl font-bold text-red-600">{formatNumber(totalDebtorsAmount)} TL</p>
                    </div>
                </div>
        
                <div className="mb-4">
                    <input
                        type="text"
                        placeholder="Müşteri Ara..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                </div>
        
                {/* FIX: Filter buttons and list limit buttons are now on the same line */}
                <div className="mb-6 flex flex-wrap items-center space-x-2">
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setFilterType('all')}
                            className={`px-4 py-2 rounded-md font-medium ${filterType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Tümü
                        </button>
                        <button
                            onClick={() => setFilterType('debtors')}
                            className={`px-4 py-2 rounded-md font-medium ${filterType === 'debtors' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Borçlular
                        </button>
                        <button
                            onClick={() => setFilterType('non-debtors')}
                            className={`px-4 py-2 rounded-md font-medium ${filterType === 'non-debtors' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Borçsuzlar
                        </button>
                    </div>
                    
                    {/* FIX: Müşteri listesi limitini belirleme butonları eklendi. */}
                    <div className="flex space-x-2">
                        <button
                            onClick={() => setCustomerLimit(5)}
                            className={`px-4 py-2 rounded-md font-medium ${customerLimit === 5 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Son 5
                        </button>
                        <button
                            onClick={() => setCustomerLimit(10)}
                            className={`px-4 py-2 rounded-md font-medium ${customerLimit === 10 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Son 10
                        </button>
                        <button
                            onClick={() => setCustomerLimit(20)}
                            className={`px-4 py-2 rounded-md font-medium ${customerLimit === 20 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Son 20
                        </button>
                        <button
                            onClick={() => setCustomerLimit(Infinity)}
                            className={`px-4 py-2 rounded-md font-medium ${customerLimit === Infinity ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                        >
                            Tümü
                        </button>
                    </div>
                </div>
        
                {/* FIX: Export button for Customers page */}
                <div className="flex justify-end p-4">
                    <button
                        onClick={exportCustomersToExcel}
                        className={`px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${!isXLSXLoaded ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-700'}`}
                        disabled={!isXLSXLoaded}
                    >
                        Excel'e Aktar (Müşteriler)
                    </button>
                </div>

                {customerDebts.length === 0 ? (
                    <p className="text-gray-600">Gösterilecek müşteri bulunmamaktadır.</p>
                ) : (
                    // FIX: Reduced the vertical gap between customer cards and reduced padding inside the cards
                    <div className="grid grid-cols-1 gap-1">
                        {customerDebts.slice(0, customerLimit === Infinity ? customerDebts.length : customerLimit).map((customer, index) => (
                            <div
                                key={index}
                                className="bg-gray-50 p-2 rounded-lg shadow-sm hover:bg-gray-100 cursor-pointer transition-colors"
                                onClick={() => handleCustomerClick(customer)}
                            >
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xl font-semibold text-gray-800">{customer.name}</h3>
                                    <p className={`text-lg font-bold ${customer.totalDebt > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                        {formatNumber(customer.totalDebt)} TL
                                    </p>
                                </div>
                                {customer.totalDebt > 0 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation(); // Modülün açılmasını engelle
                                            setCurrentCustomerForCollection(customer);
                                            // FIX: The collectionAmount state is now initialized here for collection.
                                            setCollectionAmount(customer.totalDebt.toFixed(0));
                                            setShowCollectModal(true);
                                        }}
                                        className="px-3 py-1 bg-indigo-500 text-white text-sm font-semibold rounded-md hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 mt-2"
                                    >
                                        Tahsilat Yap
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
                <Modal
                    show={showCollectModal}
                    title={`Tahsilat Yap: ${currentCustomerForCollection?.name || ''}`}
                    message={`Tahsil edilecek miktarı girin (Toplam Borç: ${formatNumber(currentCustomerForCollection?.totalDebt || 0)} TL):`}
                    onConfirm={handleCollectPayment}
                    onCancel={() => setShowCollectModal(false)}
                >
                    <input
                        type="number"
                        value={collectionAmount}
                        onChange={(e) => setCollectionAmount(e.target.value)}
                        className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="Tahsilat Miktarı (TL)"
                    />
                </Modal>
                <Modal
                    show={showTransactionModal}
                    title={transactionModalTitle}
                    onConfirm={() => setShowTransactionModal(false)}
                    onCancel={() => setShowTransactionModal(false)}
                    // FIX: Increased the modal size for better table visibility
                    maxWidth="max-w-4xl"
                >
                    {/* FIX: Tablo artık yatay kaydırma çubuğu olmadan tam ekranda düzgün görünüyor. */}
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tarih</th>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ürün</th>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Miktar</th>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Toplam Fiyat</th>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Alınan Ödeme</th>
                                    <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Kalan Bakiye</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {selectedCustomerTransactions.map((sale, saleIndex) => (
                                    <tr key={saleIndex}>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">{sale.date}</td>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">
                                            {sale.itemType} {sale.itemType === 'Zeytin' ? `(${sale.oliveSubtype})` : ''}
                                            {sale.itemType === 'Zeytinyağı' ? ` (${sale.canType}'lık Teneke)` : ''}
                                        </td>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">{formatNumber(sale.quantity)} {sale.itemType === 'Zeytin' ? 'kg' : 'lt'}</td>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">{formatNumber(sale.totalPrice)} TL</td>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">{formatNumber(sale.receivedAmount)} TL</td>
                                        <td className="px-4 py-1 whitespace-nowrap text-sm text-gray-900">{formatNumber(sale.remainingBalance)} TL</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Modal>
            </div >
        );
    };

    // Payments/Expenses component
    const TransactionsPage = () => {
        const initialTransactionState = {
            date: '',
            description: '',
            amount: '',
            type: 'Gider', // Varsayılan değer
        };
        const [newTransaction, setNewTransaction] = useState(initialTransactionState);
        const [editingTransaction, setEditingTransaction] = useState(null);
        const [transactionLimit, setTransactionLimit] = useState(10);

        const filteredTransactions = transactions.filter(t => t.category !== 'Zeytin Alım Maliyeti' && t.category !== 'Genel Finansal Durum').sort((a, b) => new Date(b.date) - new Date(a.date));
        const displayedTransactions = transactionLimit === Infinity ? filteredTransactions : filteredTransactions.slice(0, transactionLimit);

        const columns = [
            { header: 'Tarih', field: 'date' },
            { header: 'Açıklama', field: 'description' },
            { header: 'Tutar', field: 'amount', render: (row) => `${formatNumber(row.amount)} TL` },
            { header: 'Tip', field: 'type' },
        ];

        const exportToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredTransactions, columns, "İşlemler", showToast);
        };


        const handleChange = (e) => {
            const { name, value } = e.target;
            setNewTransaction(prev => ({ ...prev, [name]: value }));
        };

        const handleSubmit = async (e) => {
            e.preventDefault();
            if (editingTransaction) {
                await updateDocument('transactions', editingTransaction.id, newTransaction);
                setEditingTransaction(null);
            } else {
                await addTransaction(newTransaction);
            }
            setNewTransaction(initialTransactionState);
        };

        const handleEdit = (transaction) => {
            setEditingTransaction(transaction);
            setNewTransaction(transaction);
        };

        const handleCancelEdit = () => {
            setEditingTransaction(null);
            setNewTransaction(initialTransactionState);
        };

        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Ödemeler ve Giderler</h2>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormInput label="Tarih" type="date" name="date" value={newTransaction.date} onChange={handleChange} required />
                    <FormInput label="Açıklama" name="description" value={newTransaction.description} onChange={handleChange} required />
                    <FormInput label="Tutar" type="number" name="amount" value={newTransaction.amount} onChange={handleChange} required />
                    <FormInput
                        label="Tip"
                        type="select"
                        name="type"
                        value={newTransaction.type}
                        onChange={handleChange}
                        options={[{ value: 'Gider', label: 'Gider' }, { value: 'Gelir', label: 'Gelir' }]}
                    />
                    <div className="md:col-span-2 flex justify-end space-x-2">
                        <button
                            type="submit"
                            className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-md shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                        >
                            {editingTransaction ? 'İşlemi Güncelle' : 'İşlem Ekle'}
                        </button>
                        {editingTransaction && (
                            <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="px-6 py-2 bg-gray-400 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                            >
                                İptal
                            </button>
                        )}
                    </div>
                </form>

                <h3 className="text-xl font-semibold text-gray-800 mt-8 mb-4">Geçmiş İşlemler</h3>
                <div className="mb-4 flex space-x-2">
                    <button
                        onClick={() => setTransactionLimit(5)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 5 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 5
                    </button>
                    <button
                        onClick={() => setTransactionLimit(10)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 10 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 10
                    </button>
                    <button
                        onClick={() => setTransactionLimit(20)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 20 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 20
                    </button>
                    <button
                        onClick={() => setTransactionLimit(50)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === 50 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Son 50
                    </button>
                    <button
                        onClick={() => setTransactionLimit(Infinity)}
                        className={`px-4 py-2 rounded-md font-medium ${transactionLimit === Infinity ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    >
                        Tümü
                    </button>
                </div>
                <Table data={displayedTransactions} columns={columns} onDelete={deleteDocument} onEdit={handleEdit} collectionName="transactions" transactionLimit={transactionLimit} setTableLimit={setTableLimit} exportData={exportToExcel} isXLSXLoaded={isXLSXLoaded} />
            </div>
        );
    };

    // Genel Borçlarım ve Varlıklar Component
    const GeneralFinancialStatus = ({ addTransaction, transactions, deleteDocument, updateDocument, isXLSXLoaded }) => {
        const initialAssetItemState = {
            description: '',
            amount: '',
            type: 'Varlık',
            category: 'Genel Finansal Durum',
        };
        const initialDebtItemState = {
            description: '',
            amount: '',
            type: 'Borç',
            category: 'Genel Finansal Durum',
        };

        const [newAsset, setNewAsset] = useState(initialAssetItemState);
        const [newDebt, setNewDebt] = useState(initialDebtItemState);
        const [editingGeneralItem, setEditingGeneralItem] = useState(null);

        const handleAssetChange = (e) => {
            const { name, value } = e.target;
            setNewAsset(prev => ({ ...prev, [name]: value }));
        };

        const handleDebtChange = (e) => {
            const { name, value } = e.target;
            setNewDebt(prev => ({ ...prev, [name]: value }));
        };

        const handleAssetSubmit = async (e) => {
            e.preventDefault();
            const dataToSave = {
                ...newAsset,
                amount: parseFloat(newAsset.amount || 0).toFixed(0),
                date: new Date().toISOString().slice(0,10)
            };

            if (editingGeneralItem && editingGeneralItem.type === 'Varlık') {
                await updateDocument('transactions', editingGeneralItem.id, dataToSave);
                setEditingGeneralItem(null);
            } else {
                await addTransaction(dataToSave);
            }
            setNewAsset(initialAssetItemState);
        };

        const handleDebtSubmit = async (e) => {
            e.preventDefault();
            const dataToSave = {
                ...newDebt,
                amount: parseFloat(newDebt.amount || 0).toFixed(0),
                date: new Date().toISOString().slice(0,10)
            };

            if (editingGeneralItem && editingGeneralItem.type === 'Borç') {
                await updateDocument('transactions', editingGeneralItem.id, dataToSave); // Corrected updateDoc call
                setEditingGeneralItem(null);
            } else {
                await addTransaction(dataToSave);
            }
            setNewDebt(initialDebtItemState);
        };

        const handleEdit = (item) => {
            setEditingGeneralItem(item);
            if (item.type === 'Varlık') {
                setNewAsset(item);
                setNewDebt(initialDebtItemState);
            } else {
                setNewDebt(item);
                setNewAsset(initialAssetItemState);
            }
        };

        const handleCancelEdit = () => {
            setEditingGeneralItem(null);
            setNewAsset(initialAssetItemState);
            setNewDebt(initialDebtItemState);
        };

        const columnsForGeneralItems = [
            { header: 'Açıklama', field: 'description' },
            { header: 'Tutar', field: 'amount', render: (row) => `${formatNumber(row.amount)} TL` },
            { header: 'Tip', field: 'type' },
        ];

        const filteredGeneralItems = transactions.filter(t => t.category === 'Genel Finansal Durum').sort((a, b) => new Date(b.date) - new Date(a.date));
        
        const exportToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            exportDataToExcel(filteredGeneralItems, columnsForGeneralItems, "Genel Finansal Durum", showToast);
        };

        const totalGeneralDebts = filteredGeneralItems.filter(item => item.type === 'Borç').reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
        const totalGeneralAssets = filteredGeneralItems.filter(item => item.type === 'Varlık').reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
        const generalDifference = totalGeneralAssets - totalGeneralDebts;

        return (
            <div className="p-6 bg-white rounded-lg shadow-md mt-8">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Genel Borçlarım ve Varlıklarım</h3>

                <div className="bg-red-50 p-4 rounded-lg shadow-sm mb-6">
                    <h4 className="text-lg font-semibold text-red-800 mb-4">Borçlar</h4>
                    <form onSubmit={handleDebtSubmit} className="flex flex-col sm:flex-row gap-4 items-end">
                        <FormInput label="Açıklama" name="description" value={newDebt.description} onChange={handleDebtChange} className="flex-grow" required />
                        <FormInput label="Tutar" type="number" name="amount" value={newDebt.amount} onChange={handleDebtChange} className="w-full sm:w-auto" required />
                        <div className="flex-shrink-0 flex justify-end space-x-2 w-full sm:w-auto">
                            <button
                                type="submit"
                                className="px-6 py-2 bg-red-600 text-white font-semibold rounded-md shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                            >
                                {editingGeneralItem && editingGeneralItem.type === 'Borç' ? 'Borcu Güncelle' : 'Borç Ekle'}
                            </button>
                            {editingGeneralItem && editingGeneralItem.type === 'Borç' && (
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="px-6 py-2 bg-gray-400 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                                >
                                    İptal
                                </button>
                            )}
                        </div>
                    </form>
                    <h5 className="text-md font-semibold text-gray-800 mt-6 mb-2">Borçlarım</h5>
                    <Table
                        data={filteredGeneralItems.filter(item => item.type === 'Borç')}
                        columns={columnsForGeneralItems}
                        onDelete={deleteDocument}
                        onEdit={handleEdit}
                        collectionName="transactions"
                        transactionLimit={Infinity}
                        setTransactionLimit={() => {}}
                        // exportData={exportToExcel} // Removed export button as per user request
                        isXLSXLoaded={isXLSXLoaded} // Pass loading status
                    />
                </div>

                <div className="bg-green-50 p-4 rounded-lg shadow-sm mb-6">
                    <h4 className="text-lg font-semibold text-green-800 mb-4">Varlıklar</h4>
                    <form onSubmit={handleAssetSubmit} className="flex flex-col sm:flex-row gap-4 items-end">
                        <FormInput label="Açıklama" name="description" value={newAsset.description} onChange={handleAssetChange} className="flex-grow" required />
                        <FormInput label="Tutar" type="number" name="amount" value={newAsset.amount} onChange={handleAssetChange} className="w-full sm:w-auto" required />
                        <div className="flex-shrink-0 flex justify-end space-x-2 w-full sm:w-auto">
                            <button
                                type="submit"
                                className="px-6 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                            >
                                {editingGeneralItem && editingGeneralItem.type === 'Varlık' ? 'Varlığı Güncelle' : 'Varlık Ekle'}
                            </button>
                            {editingGeneralItem && editingGeneralItem.type === 'Varlık' && (
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="px-6 py-2 bg-gray-400 text-white font-semibold rounded-md shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2"
                                >
                                    İptal
                                </button>
                            )}
                        </div>
                    </form>
                    <h5 className="text-md font-semibold text-gray-800 mt-6 mb-2">Varlıklarım</h5>
                    <Table
                        data={filteredGeneralItems.filter(item => item.type === 'Varlık')}
                        columns={columnsForGeneralItems}
                        onDelete={deleteDocument}
                        onEdit={handleEdit}
                        collectionName="transactions"
                        transactionLimit={Infinity}
                        setTransactionLimit={() => {}}
                        // exportData={exportToExcel} // Removed export button as per user request
                        isXLSXLoaded={isXLSXLoaded} // Pass loading status
                    />
                </div>

                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-yellow-50 rounded-lg shadow-sm">
                    <div className="text-left">
                        <h4 className="text-lg font-semibold text-green-800">Toplam Genel Varlıklar:</h4>
                        <p className="text-2xl font-bold text-green-600">{formatNumber(totalGeneralAssets)} TL</p>
                    </div>
                    <div className="text-center">
                        <h4 className="text-lg font-semibold text-red-800">Toplam Genel Borçlar:</h4>
                        <p className="text-2xl font-bold text-red-600">{formatNumber(totalGeneralDebts)} TL</p>
                    </div>
                    <div className="text-right">
                        <h4 className="text-lg font-semibold text-gray-800">Fark:</h4>
                        <p className={`text-2xl font-bold ${generalDifference >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatNumber(generalDifference)} TL</p>
                    </div>
                </div>
            </div>
        );
    };

    // Payment Plan Page Component
    const PaymentPlanPage = ({ setShowModal, setModalContent, isXLSXLoaded, showToast }) => { // Pass isXLSXLoaded and showToast
        const [monthlyData, setMonthlyData] = useState({});
        const [showDeleteModal, setShowDeleteModal] = useState(false);
        const [itemToDelete, setItemToDelete] = useState(null);

        const monthNames = [
            'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
            'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
        ];

        const getNextSixMonths = useCallback(() => {
            const months = [];
            const today = new Date();
            for (let i = 0; i < 6; i++) {
                const date = new Date(today.getFullYear(), today.getMonth() + i, 1);
                const year = date.getFullYear();
                const monthIndex = date.getMonth();
                const monthNumber = (monthIndex + 1).toString().padStart(2, '0');
                months.push({
                    key: `${year}-${monthNumber}`,
                    name: `${year}-${monthNames[monthIndex]}`,
                });
            }
            return months;
        }, []);

        const nextSixMonths = useMemo(() => getNextSixMonths(), [getNextSixMonths]);

        useEffect(() => {
            const initialData = {};
            nextSixMonths.forEach(month => {
                initialData[month.key] = paymentPlans[month.key] || { payments: [], receivables: [] };
            });

            if (JSON.stringify(initialData) !== JSON.stringify(monthlyData)) {
                setMonthlyData(initialData);
            }
        }, [paymentPlans, nextSixMonths]);

        // İlk yüklemede devir hesaplamasını yap
        useEffect(() => {
            if (Object.keys(monthlyData).length > 0 && Object.keys(paymentPlans).length > 0) {
                // İlk ay için devir hesaplamasını başlat
                const firstMonthKey = nextSixMonths[0]?.key;
                if (firstMonthKey && monthlyData[firstMonthKey]) {
                    // Sadece bir kez çalıştır
                    const timeoutId = setTimeout(() => {
                        console.log('İlk yüklemede devir hesaplaması başlatılıyor...');
                        console.log('İlk ay verisi:', monthlyData[firstMonthKey]);
                        // saveAndCascadeMonthData fonksiyonu henüz tanımlanmadığı için burada çağırmıyoruz
                        // Bunun yerine sadece log yazıyoruz
                    }, 2000); // Daha uzun bekle
                    return () => clearTimeout(timeoutId);
                }
            }
        }, [monthlyData, paymentPlans]); // saveAndCascadeMonthData'yı kaldırdık

        const saveAndCascadeMonthData = useCallback(async (startMonthKey, dataForStartMonth) => {
            try {
                console.log('Devir hesaplaması başlatıldı:', startMonthKey, dataForStartMonth);
                
                // Güncel monthlyData'yı al
                const currentMonthlyData = structuredClone ? structuredClone(monthlyData) : JSON.parse(JSON.stringify(monthlyData));
                currentMonthlyData[startMonthKey] = dataForStartMonth;

                let hasChanges = false;

                for (let i = nextSixMonths.findIndex(m => m.key === startMonthKey); i < nextSixMonths.length; i++) {
                    const monthKey = nextSixMonths[i].key;
                    let currentMonthData = currentMonthlyData[monthKey] || { payments: [], receivables: [] };

                    if (i > 0) {
                        const prevMonthKey = nextSixMonths[i - 1].key;
                        const prevMonthData = currentMonthlyData[prevMonthKey] || { payments: [], receivables: [] };
                        const totalPrevPayments = prevMonthData.payments.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
                        const totalPrevReceivables = prevMonthData.receivables.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
                        const prevMonthDifference = totalPrevReceivables - totalPrevPayments;

                        console.log(`${prevMonthKey} ayı farkı:`, prevMonthDifference, 'TL');

                        // Önceki devir öğelerini temizle (sadece aynı önceki aydan olanları)
                        const oldPaymentsCount = currentMonthData.payments.length;
                        const oldReceivablesCount = currentMonthData.receivables.length;
                        
                        currentMonthData.payments = currentMonthData.payments.filter(item => !(item.type === 'carry_over_payment' && item.fromMonth === prevMonthKey));
                        currentMonthData.receivables = currentMonthData.receivables.filter(item => !(item.type === 'carry_over_receivable' && item.fromMonth === prevMonthKey));

                        // Yeni devir öğesi ekle (sadece fark varsa ve 0'dan büyükse)
                        if (prevMonthDifference < 0 && Math.abs(prevMonthDifference) > 0.01) {
                            const carryOverItem = {
                                description: `Önceki aydan devir (Borç): ${prevMonthKey}`,
                                amount: Math.abs(prevMonthDifference).toFixed(0),
                                type: 'carry_over_payment',
                                fromMonth: prevMonthKey,
                            };
                            currentMonthData.payments.push(carryOverItem);
                            console.log(`${monthKey} ayına borç devri eklendi:`, carryOverItem);
                            hasChanges = true;
                        } else if (prevMonthDifference > 0 && Math.abs(prevMonthDifference) > 0.01) {
                            const carryOverItem = {
                                description: `Önceki aydan devir (Alacak): ${prevMonthKey}`,
                                amount: Math.abs(prevMonthDifference).toFixed(0),
                                type: 'carry_over_receivable',
                                fromMonth: prevMonthKey,
                            };
                            currentMonthData.receivables.push(carryOverItem);
                            console.log(`${monthKey} ayına alacak devri eklendi:`, carryOverItem);
                            hasChanges = true;
                        }

                        // Eğer devir öğeleri değiştiyse hasChanges'i true yap
                        if (oldPaymentsCount !== currentMonthData.payments.length || oldReceivablesCount !== currentMonthData.receivables.length) {
                            hasChanges = true;
                        }
                    }
                    currentMonthlyData[monthKey] = { ...currentMonthData };
                }
                
                // Sadece değişiklik varsa state'i güncelle
                if (hasChanges) {
                    setMonthlyData(currentMonthlyData);
                    console.log('Local state güncellendi, devir hesaplaması tamamlandı');
                } else {
                    console.log('Değişiklik yok, state güncellenmedi');
                }
                
                // Sonra Firebase'e kaydet (opsiyonel)
                if (db && userId) {
                    for (let i = nextSixMonths.findIndex(m => m.key === startMonthKey); i < nextSixMonths.length; i++) {
                        const monthKey = nextSixMonths[i].key;
                        try {
                            await setMonthlyPaymentPlan(monthKey, currentMonthlyData[monthKey]);
                            console.log(`${monthKey} ayı Firebase'e kaydedildi`);
                        } catch (firebaseError) {
                            console.error(`${monthKey} ayı Firebase'e kaydedilirken hata:`, firebaseError);
                            // Firebase hatası olsa bile devam et
                        }
                    }
                } else {
                    console.log('Firebase bağlantısı yok, sadece local state güncellendi');
                }
            } catch (error) {
                console.error('Devir hesaplaması sırasında hata:', error);
            }
        }, [setMonthlyPaymentPlan, nextSixMonths, monthlyData, db, userId]);

        // saveAndCascadeMonthData tanımlandıktan sonra ilk yüklemede devir hesaplamasını yap
        useEffect(() => {
            if (Object.keys(monthlyData).length > 0 && Object.keys(paymentPlans).length > 0) {
                // İlk ay için devir hesaplamasını başlat
                const firstMonthKey = nextSixMonths[0]?.key;
                if (firstMonthKey && monthlyData[firstMonthKey]) {
                    // Sadece bir kez çalıştır
                    const timeoutId = setTimeout(() => {
                        console.log('İlk yüklemede devir hesaplaması başlatılıyor...');
                        console.log('İlk ay verisi:', monthlyData[firstMonthKey]);
                        saveAndCascadeMonthData(firstMonthKey, monthlyData[firstMonthKey]);
                    }, 2000); // Daha uzun bekle
                    return () => clearTimeout(timeoutId);
                }
            }
        }, [monthlyData, paymentPlans, saveAndCascadeMonthData, nextSixMonths]);

        const handleAddItem = (monthKey, type) => {
            setMonthlyData(prev => {
                const updatedMonth = { ...prev[monthKey] };
                // FIX: Ensure new items have the 'type' property set
                updatedMonth[type] = [...updatedMonth[type], { description: '', amount: '', editable: true, type: type }];
                const newMonthlyData = { ...prev, [monthKey]: updatedMonth };
                
                // Yeni öğe eklendiğinde devir hesaplaması yapma (kullanıcı yazana kadar bekle)
                // setTimeout(() => {
                //     saveAndCascadeMonthData(monthKey, updatedMonth);
                // }, 100);
                
                return newMonthlyData;
            });
        };

        // Debounce için timeout'ları saklamak için ref kullan
        const debounceTimeouts = useRef({});

        const handleItemChange = (monthKey, type, index, field, value) => {
            setMonthlyData(prev => {
                const updatedMonth = { ...prev[monthKey] };
                const updatedValue = field === 'amount' ? value : value;
                updatedMonth[type][index] = { ...updatedMonth[type][index], [field]: updatedValue };
                const newMonthlyData = { ...prev, [monthKey]: updatedMonth };
                
                // Devir hesaplamasını sadece input alanından çıkıldığında yap
                // Yazarken devir hesaplaması yapma
                
                return newMonthlyData;
            });
        };

        const handleItemBlur = (monthKey) => {
            // Input alanından çıkıldığında hemen devir hesaplaması yap
            setTimeout(() => {
                const currentMonthData = monthlyData[monthKey];
                if (currentMonthData) {
                    console.log('handleItemBlur tetiklendi:', monthKey, currentMonthData);
                    // Sadece input alanından çıkıldığında devir hesaplaması yap
                    saveAndCascadeMonthData(monthKey, currentMonthData);
                }
            }, 50); // Çok daha kısa bekle
        };

        const handleItemKeyDown = (e, monthKey) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        };
        
        // FIX: The handleDeleteClick function now correctly deletes both editable and non-editable (carry_over) items.
        // This was the core issue. Now it handles all item types, giving the user control over all entries.
        const handleDeleteClick = (monthKey, type, index) => {
            setModalContent({
                title: 'Silme Onayı',
                message: 'Bu kaydı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.',
                onConfirm: async () => {
                    try {
                        // Modal'ı hemen kapat
                        setShowModal(false);
                        const workingMonthlyData = structuredClone ? structuredClone(monthlyData) : JSON.parse(JSON.stringify(monthlyData));
                        const updatedMonth = { ...workingMonthlyData[monthKey] };
                        updatedMonth[type] = updatedMonth[type].filter((_, i) => i !== index);
                        await saveAndCascadeMonthData(monthKey, updatedMonth);
                        showToast('Kayıt başarıyla silindi!', 'success');
                    } catch (error) {
                        console.error('Silme işlemi başarısız:', error);
                        showToast('Silme işlemi başarısız oldu.', 'error');
                    }
                },
                onCancel: () => setShowModal(false)
            });
            setShowModal(true);
        };

        const paymentPlanExportColumns = [
            { header: 'Ay', field: 'month' },
            { header: 'Açıklama', field: 'description' },
            { header: 'Tutar', field: 'amount', render: (row) => `${formatNumber(row.amount)} TL` },
            { header: 'Tip', field: 'type', render: (row) => {
                if (row.type === 'payments') return 'Ödeme';
                if (row.type === 'receivables') return 'Alacak';
                if (row.type === 'carry_over_payment') return 'Devir (Ödeme)'; // FIX: Specific type for carry-over payment
                if (row.type === 'carry_over_receivable') return 'Devir (Alacak)'; // FIX: Specific type for carry-over receivable
                return 'Bilinmiyor';
            }},
        ];

        const exportPaymentPlanToExcel = () => {
            if (!isXLSXLoaded) {
                showToast("Excel dışa aktarma kütüphanesi yüklenmedi. Lütfen sayfayı yenileyin.", "error");
                return;
            }
            const dataToExport = [];
            nextSixMonths.forEach(month => {
                const monthData = monthlyData[month.key];
                if (monthData) {
                    // Collect all payments (including carry_over_payment)
                    monthData.payments.forEach(item => {
                        dataToExport.push({ month: month.name, description: item.description, amount: parseFloat(item.amount || 0), type: item.type }); // FIX: Use item.type
                    });
                    // Collect all receivables (including carry_over_receivable)
                    monthData.receivables.forEach(item => {
                        dataToExport.push({ month: month.name, description: item.description, amount: parseFloat(item.amount || 0), type: item.type }); // FIX: Use item.type
                    });
                }
            });
            exportDataToExcel(dataToExport, paymentPlanExportColumns, "Ödeme Planı", showToast);
        };


        return (
            <div className="p-6 bg-white rounded-lg shadow-md">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">Ödeme Planım</h2>
                
                {/* Export button for Payment Plan page */}
                <div className="flex justify-end p-4">
                    <button
                        onClick={exportPaymentPlanToExcel}
                        className={`px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${!isXLSXLoaded ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-700'}`}
                        disabled={!isXLSXLoaded}
                    >
                        Excel'e Aktar (Ödeme Planı)
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                    {nextSixMonths.map(month => {
                        const monthKey = month.key;
                        const monthData = monthlyData[monthKey] || { payments: [], receivables: [] };
                        const totalPayments = monthData.payments.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
                        const totalReceivables = monthData.receivables.reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
                        const monthlyDifference = totalReceivables - totalPayments;

                        return (
                            <div key={monthKey} className="bg-gray-50 p-4 rounded-lg shadow-sm border border-gray-200">
                                <h3 className="text-xl font-bold text-gray-800 mb-4">{month.name}</h3>

                                <div className="mb-6">
                                    <h4 className="text-lg font-semibold text-green-700 mb-2">
                                        Alacaklar
                                    </h4>
                                    <button
                                        onClick={() => handleAddItem(monthKey, 'receivables')}
                                        className="mb-2 px-3 py-1 bg-green-500 text-white text-sm rounded-md hover:bg-green-600"
                                    >
                                        Alacak Ekle
                                    </button>
                                    {monthData.receivables.map((item, index) => (
                                        <div key={index} className="flex items-center space-x-2 mb-2">
                                            <input
                                                type="text"
                                                placeholder="Açıklama"
                                                value={item.description}
                                                onChange={(e) => handleItemChange(monthKey, 'receivables', index, 'description', e.target.value)}
                                                onBlur={() => handleItemBlur(monthKey)}
                                                onKeyDown={(e) => handleItemKeyDown(e, monthKey)}
                                                className="flex-1 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                readOnly={item.type === 'carry_over_receivable'} // FIX: ReadOnly for carry_over_receivable
                                            />
                                            <input
                                                type="number"
                                                placeholder="Tutar"
                                                value={item.amount}
                                                onChange={(e) => handleItemChange(monthKey, 'receivables', index, 'amount', e.target.value)}
                                                onBlur={() => handleItemBlur(monthKey)}
                                                onKeyDown={(e) => handleItemKeyDown(e, monthKey)}
                                                className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                readOnly={item.type === 'carry_over_receivable'} // FIX: ReadOnly for carry_over_receivable
                                            />
                                            <button
                                                onClick={() => handleDeleteClick(monthKey, 'receivables', index)}
                                                className="text-red-500 hover:text-red-700 focus:outline-none"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 100 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                    <p className="text-lg font-semibold text-green-700 mt-2">
                                        Toplam: {formatNumber(totalReceivables)} TL
                                    </p>
                                </div>

                                <div className="mb-6">
                                    <h4 className="text-lg font-semibold text-red-700 mb-2">
                                        Ödemeler
                                    </h4>
                                    <button
                                        onClick={() => handleAddItem(monthKey, 'payments')}
                                        className="mb-2 px-3 py-1 bg-red-500 text-white text-sm rounded-md hover:bg-red-600"
                                    >
                                        Ödeme Ekle
                                    </button>
                                    {monthData.payments.map((item, index) => (
                                        <div key={index} className="flex items-center space-x-2 mb-2">
                                            <input
                                                type="text"
                                                placeholder="Açıklama"
                                                value={item.description}
                                                onChange={(e) => handleItemChange(monthKey, 'payments', index, 'description', e.target.value)}
                                                onBlur={() => handleItemBlur(monthKey)}
                                                onKeyDown={(e) => handleItemKeyDown(e, monthKey)}
                                                className="flex-1 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                readOnly={item.type === 'carry_over_payment'} // FIX: ReadOnly for carry_over_payment
                                            />
                                            <input
                                                type="number"
                                                placeholder="Tutar"
                                                value={item.amount}
                                                onChange={(e) => handleItemChange(monthKey, 'payments', index, 'amount', e.target.value)}
                                                onBlur={() => handleItemBlur(monthKey)}
                                                onKeyDown={(e) => handleItemKeyDown(e, monthKey)}
                                                className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm"
                                                readOnly={item.type === 'carry_over_payment'} // FIX: ReadOnly for carry_over_payment
                                            />
                                            <button
                                                onClick={() => handleDeleteClick(monthKey, 'payments', index)}
                                                className="text-red-500 hover:text-red-700 focus:outline-none"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1zm-1 3a1 1 0 100 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                    <p className="text-lg font-semibold text-red-700 mt-2">
                                        Toplam: {formatNumber(totalPayments)} TL
                                    </p>
                                </div>

                                <p className={`text-lg font-bold mt-4 ${monthlyDifference >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                                    Fark: {formatNumber(monthlyDifference)} TL
                                </p>
                            </div>
                        );
                    })}
                </div>
                <GeneralFinancialStatus addTransaction={addTransaction} transactions={transactions} deleteDocument={deleteDocument} updateDocument={updateDocument} />
            </div>
        );
    };


    // Render page content
    const renderPage = () => {
        switch (currentPage) {
            case 'dashboard':
                return <Dashboard />;
            case 'oliveTransactions':
                return <OliveTransactionsPage isXLSXLoaded={isXLSXLoaded} showToast={showToast} />; // Pass isXLSXLoaded and showToast
            case 'oliveOilTransactions':
                return <OliveOilTransactionsPage isXLSXLoaded={isXLSXLoaded} showToast={showToast} />; // Pass isXLSXLoaded and showToast
            case 'customers':
                return <CustomersPage isXLSXLoaded={isXLSXLoaded} showToast={showToast} />; // Pass isXLSXLoaded and showToast
            case 'paymentPlan':
                return <PaymentPlanPage setShowModal={setShowModal} setModalContent={setModalContent} isXLSXLoaded={isXLSXLoaded} showToast={showToast} />;
            default:
                return <Dashboard />;
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 font-inter antialiased">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                button {
                    transition: all 0.2s ease-in-out;
                }
                button:hover {
                    transform: translateY(-1px);
                }
                input:focus, select:focus {
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5);
                }
                table th, table td {
                    padding: 0.75rem 0.5rem; /* Azaltılmış padding */
                    white-space: normal; /* Normal boşluk bırakma */
                }
                .customer-transactions-table td {
                    padding-top: 0.5rem;
                    padding-bottom: 0.5rem;
                }
                table thead tr {
                    white-space: nowrap;
                }
                table tbody tr:nth-child(even) {
                    background-color: #f9fafb;
                }
                table tbody tr:hover {
                    background-color: #f3f4f6;
                }
                .hidden {
                    display: none;
                }
                `}
            </style>
            <script src="https://cdn.tailwindcss.com"></script>
            {/* FIX: xlsx kütüphanesi için harici CDN linki eklendi */}
            {/* Bu script etiketi artık App bileşeninde dinamik olarak oluşturuluyor ve yönetiliyor. */}
            {/* <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.17.0/xlsx.full.min.js"></script> */}

            <nav className="bg-gray-800 p-4 shadow-lg">
                <div className="container mx-auto flex flex-wrap justify-between items-center">
                    <div className="text-white text-2xl font-bold rounded-md px-3 py-1 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-md">
                        Hesap Takip
                    </div>
                    <div className="flex flex-wrap space-x-2 md:space-x-4 mt-2 md:mt-0">
                        <button
                            onClick={() => setCurrentPage('dashboard')}
                            className={`px-4 py-2 rounded-md font-medium ${currentPage === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                        >
                            Ana Sayfa
                        </button>
                        <button
                            onClick={() => setCurrentPage('oliveTransactions')}
                            className={`px-4 py-2 rounded-md font-medium ${currentPage === 'oliveTransactions' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                        >
                            Zeytin İşlemleri
                        </button>
                        <button
                            onClick={() => setCurrentPage('oliveOilTransactions')}
                            className={`px-4 py-2 rounded-md font-medium ${currentPage === 'oliveOilTransactions' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                        >
                            Zeytinyağı İşlemleri
                        </button>
                        <button
                            onClick={() => setCurrentPage('customers')}
                            className={`px-4 py-2 rounded-md font-medium ${currentPage === 'customers' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                        >
                            Müşterilerimiz
                        </button>
                        <button
                            onClick={() => setCurrentPage('paymentPlan')}
                            className={`px-4 py-2 rounded-md font-medium ${currentPage === 'paymentPlan' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                        >
                            Ödeme Planım
                        </button>
                        <button
                            onClick={() => setIsLoggedIn(false)}
                            className="px-4 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 shadow-md"
                        >
                            Çıkış Yap
                        </button>
                    </div>
                </div>
            </nav>

            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                {userId && (
                    <div className="mb-4 text-sm text-gray-600 text-center md:text-right">
                        Kullanıcı ID: <span className="font-mono bg-gray-200 px-2 py-1 rounded-md">{userId}</span>
                    </div>
                )}
                {renderPage()}
            </main>

            <Modal
                show={showModal}
                title={modalContent.title}
                message={modalContent.message}
                onConfirm={modalContent.onConfirm}
                onCancel={modalContent.onCancel}
            >
                {modalContent.children}
            </Modal>
            
            
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
}

export default App;

// Kullanıcının gönderdiği kodun tamamı yukarıda yer alıyor. 