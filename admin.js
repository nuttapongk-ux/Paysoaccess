import { db, auth } from './firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// DOM Elements
const loadingIndicator = document.getElementById('loadingIndicator');
const adminContent = document.getElementById('adminContent');
const categoriesList = document.getElementById('categoriesList');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const saveLoader = document.getElementById('saveLoader');
const statusMessage = document.getElementById('statusMessage');

// Initial State / Default Data Structure
let menuData = [
    {
        id: "gen_1",
        title: "",                 
        isHeader: false,
        items: ["แดชบอร์ด", "ยอดรวมรายได้", "ประวัติการโอนเงินคืน"]
    },
    {
        id: "cat_1",
        title: "รายการสั่งซื้อและผู้ซื้อ",
        isHeader: true,
        items: ["รายการสั่งซื้อทั้งหมด", "คืนเงินหรือยกเลิกรายการ", "อัตราแลกเปลี่ยน"]
    },
    {
        id: "cat_2",
        title: "จัดการข้อมูลร้านค้า",
        isHeader: true,
        items: ["ตั้งค่าเบื้องต้น", "ข้อมูลส่วนตัว", "แก้ไขข้อมูลส่วนตัว", "แก้ไขข้อมูลบัญชีธนาคาร", "เปลี่ยนรหัสผ่าน", "ข้อมูลใบกำกับภาษี", "ส่งค่ากลับเว็บไซต์หลัก", "จัดการเอกสาร"]
    },
    {
        id: "cat_3",
        title: "ลิงก์ชำระเงิน (Pay.sn)",
        isHeader: true,
        items: ["ลิงก์รับชำระเงินของร้านค้า", "ลิงก์รับชำระเงินแบบกำหนดเวลา", "เทคนิคการใช้งาน"]
    },
    {
        id: "cat_4",
        title: "บริการชำระเงินอัตโนมัติ",
        isHeader: true,
        items: ["สร้างรายการชำระเงินอัตโนมัติ", "การชำระเงินอัตโนมัติ"]
    },
    {
        id: "gen_2",
        title: "",
        isHeader: false,
        items: ["เพิ่มโลโก้ชำระเงินบนเว็บไซต์", "ข่าวสารและกิจกรรมใหม่", "ดาวน์โหลดใบเสร็จ / ใบกำกับภาษี อิเล็กทรอนิกส์"]
    }
];

const genId = () => Math.random().toString(36).substr(2, 9);

const showMessage = (msg, type = 'success') => {
    statusMessage.textContent = msg;
    statusMessage.className = `status-message ${type}`;
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
    }, 5000);
};

// Render logic
const renderAdminView = () => {
    categoriesList.innerHTML = '';
    
    menuData.forEach((category, catIndex) => {
        const catCard = document.createElement('div');
        catCard.className = 'category-card';
        
        // Migrate incoming old data strings onto object specs
        const standardizedItems = category.items.map(i => typeof i === 'string' ? { name: i, isLocked: false } : i );
        menuData[catIndex].items = standardizedItems; // Mutate backwards for safety

        // Items HTML
        const itemsHtml = standardizedItems.map((item, itemIndex) => `
            <div class="item-row">
                <span style="color:#94a3b8;">☰</span>
                <input type="text" class="item-input" value="${item.name}" data-cat="${catIndex}" data-item="${itemIndex}" placeholder="Menu Item Name">
                <label style="font-size:0.8rem; display:flex; align-items:center; gap:0.25rem; color:#dc2626;">
                    <input type="checkbox" class="item-lock-toggle" data-cat="${catIndex}" data-item="${itemIndex}" ${item.isLocked ? 'checked' : ''}> 🔒 Lock
                </label>
                <button type="button" class="btn-text-danger delete-item-btn" data-cat="${catIndex}" data-item="${itemIndex}">✕</button>
            </div>
        `).join('');

        catCard.innerHTML = `
            <div class="category-header">
                <div style="flex:1; display:flex; gap:1rem; align-items:center;">
                    <input type="text" class="cat-title-input" value="${category.title || ''}" data-cat="${catIndex}" placeholder="Main Menu (Leave blank for generic list without parent)" style="width: 50%; padding: 0.5rem; border-radius: 8px; border: 1px solid #cbd5e1;">
                    <label style="font-size:0.85rem; display:flex; align-items:center; gap:0.25rem; color:#dc2626;">
                        <input type="checkbox" class="cat-lock-toggle" data-cat="${catIndex}" ${category.isTitleLocked ? 'checked' : ''}> 🔒 Force Checked
                    </label>
                </div>
                <button type="button" class="btn-text-danger delete-cat-btn" data-cat="${catIndex}">Delete Category</button>
            </div>
            <div class="items-container">
                ${itemsHtml}
            </div>
            <button type="button" class="btn-add-item" data-cat="${catIndex}">+ Add Sub Menu</button>
        `;
        categoriesList.appendChild(catCard);
    });

    attachEventListeners();
};

const attachEventListeners = () => {
    // Inputs listener to update object
    document.querySelectorAll('.cat-title-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-cat');
            menuData[idx].title = e.target.value;
        });
    });

    document.querySelectorAll('.cat-lock-toggle').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-cat');
            menuData[idx].isTitleLocked = e.target.checked;
        });
    });

    document.querySelectorAll('.item-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const cIdx = e.target.getAttribute('data-cat');
            const iIdx = e.target.getAttribute('data-item');
            menuData[cIdx].items[iIdx].name = e.target.value;
        });
    });

    document.querySelectorAll('.item-lock-toggle').forEach(input => {
        input.addEventListener('change', (e) => {
            const cIdx = e.target.getAttribute('data-cat');
            const iIdx = e.target.getAttribute('data-item');
            menuData[cIdx].items[iIdx].isLocked = e.target.checked;
        });
    });

    document.querySelectorAll('.delete-item-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const cIdx = e.target.getAttribute('data-cat');
            const iIdx = e.target.getAttribute('data-item');
            menuData[cIdx].items.splice(iIdx, 1);
            renderAdminView();
        });
    });

    document.querySelectorAll('.delete-cat-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if(confirm('Are you sure you want to delete this entire category?')) {
                const cIdx = e.target.getAttribute('data-cat');
                menuData.splice(cIdx, 1);
                renderAdminView();
            }
        });
    });

    document.querySelectorAll('.btn-add-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const cIdx = e.target.getAttribute('data-cat');
            menuData[cIdx].items.push('New Item');
            renderAdminView();
        });
    });
};

addCategoryBtn.addEventListener('click', () => {
    menuData.push({
        id: genId(),
        title: 'New Category',
        isTitleLocked: false,
        items: []
    });
    renderAdminView();
});

// Firebase Loading/Saving
const menuDocRef = doc(db, 'system_settings', 'menu_configuration');

const loadConfig = async () => {
    try {
        const docSnap = await getDoc(menuDocRef);
        if (docSnap.exists()) {
            menuData = docSnap.data().categories;
        } else {
            // Document doesn't exist, use default and save it
            console.log("No config found, pushing default.");
            await setDoc(menuDocRef, { categories: menuData, updatedAt: serverTimestamp() });
        }
        loadingIndicator.classList.add('hidden');
        adminContent.classList.remove('hidden');
        renderAdminView();
    } catch (e) {
        console.error(e);
        loadingIndicator.textContent = "Failed to load config: " + e.message;
    }
};

saveConfigBtn.addEventListener('click', async () => {
    saveConfigBtn.disabled = true;
    saveLoader.classList.remove('hidden');
    try {
        // Filter out empty items to clean up
        const cleanedData = menuData.map(cat => ({
            ...cat,
            items: cat.items
                .map(i => typeof i === 'string' ? { name: i, isLocked: false } : i)
                .filter(i => i.name && i.name.trim().length > 0)
        }));
        menuData = cleanedData; // update state

        await setDoc(menuDocRef, { categories: menuData, updatedAt: serverTimestamp() });
        showMessage('Configuration saved successfully to Firebase!');
        renderAdminView(); // re-render clean
    } catch (error) {
        console.error(error);
        showMessage(error.message, 'error');
    } finally {
        saveConfigBtn.disabled = false;
        saveLoader.classList.add('hidden');
    }
});

// Init
const initAdmin = () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = 'login.html';
        } else {
            console.log("Admin logged in as:", user.email);
            loadConfig();
        }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth);
        });
    }
};

initAdmin();
