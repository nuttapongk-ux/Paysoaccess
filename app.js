// ══════════════════════════════════════════════════════════════
//  Merchant Control – User & Role Request System
//  app.js – Full Working Version with Firebase + Mockup Fallback
// ══════════════════════════════════════════════════════════════

import { db, auth } from './firebase-config.js';
import {
  collection, addDoc, doc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── CONSTANTS & DYNAMIC VARS ─────────────────────────────────
let ROLES = ['sales', 'manager', 'accounting', 'IT', 'Admin', 'CEO'];
let ROLE_PRESETS = {
  'Admin': { all: true },
  'CEO': { all: true },
  'sales': { categories: ['แดชบอร์ด', 'รายการสั่งซื้อและผู้ซื้อ', 'รายงาน'], items: ['รายการสั่งซื้อทั้งหมด', 'รายงานยอดขาย'] },
  'manager': { categories: ['แดชบอร์ด', 'ยอดรวมรายได้', 'รายการสั่งซื้อและผู้ซื้อ', 'จัดการข้อมูลร้านค้า', 'รายงาน'] },
  'accounting': { categories: ['แดชบอร์ด', 'ยอดรวมรายได้', 'รายงาน'], items: ['รายงานการเงิน', 'ส่งออกรายงาน PDF', 'อัตราแลกเปลี่ยน'] },
  'IT': { categories: ['แดชบอร์ด', 'จัดการผู้ใช้งาน', 'การแจ้งเตือน'] },
};
const DEFAULT_MENUS = {
  'แดชบอร์ด': [],
  'ยอดรวมรายได้': [],
  'รายการสั่งซื้อและผู้ซื้อ': ['รายการสั่งซื้อทั้งหมด', 'คืนเงินหรือยกเลิกรายการ', 'อัตราแลกเปลี่ยน'],
  'จัดการข้อมูลร้านค้า': ['ตั้งค่าเบื้องต้น', 'ข้อมูลส่วนตัว', 'แก้ไขข้อมูลส่วนตัว', 'แก้ไขข้อมูลบัญชีธนาคาร'],
  'จัดการผู้ใช้งาน': ['เพิ่มผู้ใช้งาน', 'แก้ไขสิทธิ์ผู้ใช้งาน', 'ลบผู้ใช้งาน'],
  'รายงาน': ['รายงานยอดขาย', 'รายงานการเงิน', 'ส่งออกรายงาน PDF'],
  'การแจ้งเตือน': ['การแจ้งเตือนระบบ', 'การแจ้งเตือนทางอีเมล'],
};

// Mockups deleted per user request

// ── STATE & IDLE LOGIC ───────────────────────────────────────
let userEntryCount = 0;
let isAdminAuthenticated = false;

let idleTimeout;
function resetIdleTimer() {
  clearTimeout(idleTimeout);
  if (!isAdminAuthenticated) return;
  idleTimeout = setTimeout(async () => {
    try {
      await signOut(auth);
      showToast('หมดเวลาการใช้งาน (Idle 15 นาที) ออกจากระบบอัตโนมัติ', 'error');
    } catch (e) { }
  }, 15 * 60 * 1000); // 15 mins
}
['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, true);
});

function migrateMenus(menus) {
  const m = {};
  for (let c in menus) m[c] = menus[c].map(i => typeof i === 'string' ? { name: i, ruleId: '' } : i);
  return m;
}
let menuStructure = migrateMenus({ ...DEFAULT_MENUS });
let categoryRules = {};
let allRequests = [];
let selectedCategoryForMenu = null;
let firebaseReady = false;
let unsubscribeHistoryListener = null;

// ── ROLE-BASED ACCESS ──────────────────────────────────────
// Emails with FULL access (approve/reject + Admin tab)
const SUPER_ADMINS = [
  'admin@payso.co',
  'admin@merchant.com',
  'burin@payso.co',
  'nuttapong.k@tarad.com',
  // เพิ่ม email super-admin ตรงนี้
];
let adminRole = null; // null | 'superadmin' | 'viewer'
function isSuperAdmin() { return adminRole === 'superadmin'; }

function startHistoryListener() {
  if (unsubscribeHistoryListener) return; // already listening
  const q = query(collection(db, 'user_requests'), orderBy('createdAt', 'desc'));
  unsubscribeHistoryListener = onSnapshot(q, (snap) => {
    allRequests = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, createdAt: data.createdAt?.toDate?.() || new Date() };
    });
    renderHistory();
  }, (err) => {
    console.error('❌ History listener error:', err.code, err.message);
  });
}

// ── DOM HELPERS ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showLoginModal() {
  return new Promise((resolve) => {
    const overlay = $('admin-login-overlay');
    const emailEl = $('login-email');
    const pwdEl = $('login-password');
    const cancelBtn = $('login-cancel');
    const confirmBtn = $('login-confirm');

    emailEl.value = '';
    pwdEl.value = '';
    overlay.style.display = 'flex';
    emailEl.focus();

    const cleanup = () => {
      overlay.style.display = 'none';
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
    };

    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    confirmBtn.onclick = () => { cleanup(); resolve({ email: emailEl.value.trim(), password: pwdEl.value }); };
  });
}

function customPrompt(title, defaultValue = '', inputType = 'text') {
  return new Promise((resolve) => {
    const overlay = $('custom-prompt-overlay');
    const titleEl = $('c-prompt-title');
    const inputEl = $('c-prompt-input');
    const cancelBtn = $('c-prompt-cancel');
    const confirmBtn = $('c-prompt-confirm');

    titleEl.textContent = title;
    inputEl.type = inputType;
    inputEl.value = defaultValue;
    overlay.style.display = 'flex';
    inputEl.focus();
    inputEl.select();

    const cleanup = () => {
      overlay.style.display = 'none';
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      inputEl.onkeydown = null;
    };

    inputEl.onkeydown = (e) => {
      if (e.key === 'Enter') { cleanup(); resolve(inputEl.value); }
      if (e.key === 'Escape') { cleanup(); resolve(null); }
    };

    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    confirmBtn.onclick = () => { cleanup(); resolve(inputEl.value); };
  });
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      isAdminAuthenticated = true;
      // Determine role
      adminRole = SUPER_ADMINS.includes(user.email.toLowerCase()) ? 'superadmin' : 'viewer';

      $('display-user-name').textContent = adminRole === 'superadmin' ? 'ผู้ดูแลระบบ' : 'ผู้กำกับดูแล (Viewer)';
      $('display-user-role').textContent = user.email;
      $('btn-logout').style.display = 'block';

      // Show History tab always; Admin tab only for superadmin
      document.querySelectorAll('.restricted-tab[data-tab="history"]').forEach(el => el.style.display = '');
      if (adminRole === 'superadmin') {
        document.querySelectorAll('.restricted-tab[data-tab="admin"]').forEach(el => el.style.display = '');
      } else {
        document.querySelectorAll('.restricted-tab[data-tab="admin"]').forEach(el => el.style.display = 'none');
      }

      resetIdleTimer();
      startHistoryListener();
    } else {
      isAdminAuthenticated = false;
      adminRole = null;
      $('display-user-name').textContent = 'Guest (ผู้เข้าชม)';
      $('display-user-role').textContent = 'คลิกเพื่อเข้าสู่ระบบ';
      $('btn-logout').style.display = 'none';
      document.querySelectorAll('.restricted-tab').forEach(el => el.style.display = 'none');
      clearTimeout(idleTimeout);
      if (unsubscribeHistoryListener) { unsubscribeHistoryListener(); unsubscribeHistoryListener = null; }
      allRequests = [];
      switchTab('create');
    }
  });

  initTabs();
  loadMenuFromFirebase();
  addUserEntry();
  initAdminPanel();
  initHistory();
  initRoleAdminPanel();

  $('btn-add-user').addEventListener('click', addUserEntry);
  $('btn-reset-form').addEventListener('click', resetForm);
  $('btn-submit-form').addEventListener('click', submitForm);
  initReportForm();
});

// ── TABS ─────────────────────────────────────────────────────
const TAB_TITLES = {
  create: 'สร้างผู้ใช้งานใหม่ (Create Users)',
  history: 'ประวัติคำขอทั้งหมด',
  admin: 'จัดการเมนูและสิทธิ์ (Admin)',
  report: 'แบบฟอร์มแจ้งปัญหา',
};

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  // Init Admin Login hook
  const userInfo = $('sidebar-user-info');
  if (userInfo) {
    userInfo.addEventListener('click', async () => {
      if (isAdminAuthenticated) return;
      const credentials = await showLoginModal();
      if (credentials) {
        try {
          await signInWithEmailAndPassword(auth, credentials.email, credentials.password);
          showToast('เข้าสู่ระบบ Admin สำเร็จ', 'success');
        } catch (e) {
          console.error('Login error:', e);
          showToast('อีเมลหรือรหัสผ่านไม่ถูกต้อง', 'error');
        }
      }
    });
  }

  const logoutBtn = $('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        showToast('ออกจากระบบเรียบร้อยแล้ว', 'success');
      } catch (e) {
        showToast('เกิดข้อผิดพลาดในการออกจากระบบ', 'error');
      }
    });
  }
}

function switchTab(tab) {
  if (!isAdminAuthenticated && (tab === 'history' || tab === 'admin')) {
    showToast('กรุณาเข้าสู่ระบบ Admin ก่อน', 'error');
    return;
  }
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
  const section = $(`tab-${tab}`);
  if (section) section.classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(b => b.classList.add('active'));
  $('topbar-title').textContent = TAB_TITLES[tab] || '';
}

// ── REPORT FORM ────────────────────────────────────────────────
const REPORT_TEMPLATES = {
  payment:     { label: '💳 ปัญหาการชำระเงิน',           hint: 'ระบุ Transaction ID, เวลา, จำนวนเงิน, ช่องทางการชำระ, สถานะที่พบ' },
  account:     { label: '👤 บัญชีผู้ใช้งาน',            hint: 'ระบุ Username/Email, ปัญหาที่พบ (Login ไม่ได้, ลืมรหัส, ถูกบล็อค เป็นต้น)' },
  permission:  { label: '🔐 สิทธิ์การเข้าถึง',           hint: 'ระบุ Username, เมนูที่ไม่สามารถเข้าถึงได้, บทบาทปัจจุบัน vs ที่ต้องการ' },
  report:      { label: '📊 รายงาน / ข้อมูลผิดพลาด',        hint: 'ระบุช่วงวันที่, ชื่อรายงาน, ค่าที่แสดงผิด vs ค่าที่คาดหวัง' },
  notification:{ label: '🔔 การแจ้งเตือน',              hint: 'ระบุช่องทางที่ไม่ได้รับ (Email/Line/Push), เหตุการณ์ที่ไม่พบการแจ้งเตือน' },
  store:       { label: '🏪 ข้อมูลร้านค้า',              hint: 'ระบุไอเทมที่ผิดพลาด (ชื่อ, ที่อยู่, บัญชีธนาคาร) และสิ่งที่ต้องการแก้ไข' },
  settlement:  { label: '💰 การตัดรอบ / ยอดคงเหลือ',         hint: 'ระบุช่วงเวลาตัดรอบ, ยอดเงินที่คาดหวัง vs ยอดที่ได้รับจริง' },
  integration: { label: '🔗 เชื่อมต่อระบบ',              hint: 'ระบุระบบที่เชื่อม (API/Webhook/SDK), Error code ที่ได้รับ, เวอร์ชันที่ใช้' },
  performance: { label: '⚡ ความเร็ว / ระบบช้า',           hint: 'ระบุเวลาที่ระบบช้า, หน้าที่ใช้งาน, Browser และ OS ที่ใช้' },
  other:       { label: '❓ อื่นๆ',                         hint: 'อธิบายปัญหาโดยละเอียดเท่าที่เป็นไปได้' },
};

function initReportForm() {
  const cat = $('report-category');
  if (!cat) return;

  cat.addEventListener('change', () => {
    const val = cat.value;
    const templateArea = $('report-template-area');
    const dynamicForm = $('report-dynamic-form');
    if (!val) { templateArea.innerHTML = ''; dynamicForm.style.display = 'none'; return; }
    const tmpl = REPORT_TEMPLATES[val];
    templateArea.innerHTML = `
      <div style="background:#f0f4ff;border:1px solid #d4def7;border-radius:8px;padding:14px;margin-bottom:16px;">
        <div style="font-weight:700;color:#3c63e2;margin-bottom:6px;">${tmpl.label}</div>
        <div style="font-size:0.88rem;color:#6b7ab4;"><strong>💡 ข้อมูลที่ควรระบุ:</strong> ${tmpl.hint}</div>
      </div>`;
    dynamicForm.style.display = 'block';
    $('report-detail').placeholder = 'อธิบาย: ' + tmpl.hint;
  });

  $('btn-reset-report')?.addEventListener('click', () => {
    cat.value = '';
    $('report-template-area').innerHTML = '';
    $('report-dynamic-form').style.display = 'none';
    $('report-merchant-id').value = '';
    $('report-email').value = '';
    $('report-detail').value = '';
    $('report-extra').value = '';
  });

  $('btn-submit-report')?.addEventListener('click', async () => {
    const category = cat.value;
    const email = $('report-email').value.trim();
    const detail = $('report-detail').value.trim();
    if (!category) { showToast('กรุณาเลือกประเภทปัญหา', 'error'); return; }
    if (!email || !email.includes('@')) { showToast('กรุณาระบุอีเมลผู้แจ้ง', 'error'); return; }
    if (!detail) { showToast('กรุณาระบุรายละเอียดปัญหา', 'error'); return; }

    const btn = $('btn-submit-report');
    btn.disabled = true;
    $('report-submit-text').textContent = 'กำลังส่ง...';
    try {
      await addDoc(collection(db, 'issue_reports'), {
        category, categoryLabel: REPORT_TEMPLATES[category]?.label || category,
        merchantId: $('report-merchant-id').value.trim(),
        reporterEmail: email,
        detail, extraInfo: $('report-extra').value.trim(),
        status: 'open', createdAt: serverTimestamp(),
      });
      showToast('✅ ส่งแจ้งปัญหาสำเร็จ!', 'success');
      $('btn-reset-report').click();
    } catch(e) {
      showToast('✖️ เกิดข้อผิดพลาด: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      $('report-submit-text').textContent = '📤 ส่งแจ้งปัญหา';
    }
  });
}

// ── MENU STRUCTURE (Firebase with fallback) ──────────────────
async function loadMenuFromFirebase() {
  try {
    const docRef = doc(db, 'system_settings', 'menu_structure');
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.menusString) {
        menuStructure = migrateMenus(JSON.parse(data.menusString));
      } else if (data.menus) {
        menuStructure = migrateMenus(data.menus);
      }
      if (data.categoryRulesString) {
        categoryRules = JSON.parse(data.categoryRulesString);
      }
      if (data.rolesString) {
        ROLES = JSON.parse(data.rolesString);
      }
      if (data.rolePresetsString) {
        ROLE_PRESETS = JSON.parse(data.rolePresetsString);
      }
      firebaseReady = true;
      renderCategoryList();
      refreshAllPermissionTrees();
      renderRoleAdminList();
    } else {
      // Save defaults to Firebase
      await setDoc(docRef, {
        menusString: JSON.stringify(DEFAULT_MENUS),
        categoryRulesString: '{}',
        rolesString: JSON.stringify(ROLES),
        rolePresetsString: JSON.stringify(ROLE_PRESETS),
        menus: DEFAULT_MENUS
      });
      firebaseReady = true;
    }

    // Real-time listener for menu structure
    onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.menusString) {
          menuStructure = migrateMenus(JSON.parse(data.menusString));
        } else if (data.menus) {
          menuStructure = migrateMenus(data.menus);
        }
        if (data.categoryRulesString) {
          categoryRules = JSON.parse(data.categoryRulesString);
        }
        if (data.rolesString) {
          ROLES = JSON.parse(data.rolesString);
        }
        if (data.rolePresetsString) {
          ROLE_PRESETS = JSON.parse(data.rolePresetsString);
        }
        renderCategoryList();
        refreshAllPermissionTrees();
        renderRoleAdminList();
      }
    });
    // NOTE: user_requests listener is started in onAuthStateChanged after login
  } catch (e) {
    console.warn('Firebase connection failed:', e.message);
    firebaseReady = false;
    renderCategoryList();
    renderHistory();
  }
}

async function saveMenuStructure() {
  try {
    await setDoc(doc(db, 'system_settings', 'menu_structure'), {
      menusString: JSON.stringify(menuStructure),
      categoryRulesString: JSON.stringify(categoryRules),
      rolesString: JSON.stringify(ROLES),
      rolePresetsString: JSON.stringify(ROLE_PRESETS),
      menus: menuStructure // keep for backward compatibility
    });
  } catch (e) {
    console.warn('saveMenuStructure failed:', e.message);
  }
}

// ── USER ENTRY BLOCK ─────────────────────────────────────────
function addUserEntry() {
  const entries = document.querySelectorAll('.user-entry-block');
  if (entries.length > 0) {
    const lastEntry = entries[entries.length - 1];
    const username = lastEntry.querySelector('.field-username').value.trim();
    const email = lastEntry.querySelector('.field-email').value.trim();
    if (!username && !email) {
      showToast('กรุณากรอกข้อมูลผู้ใช้งานก่อนหน้าอย่างน้อย 1 ช่อง (ชื่อ หรือ อีเมล)', 'error');
      lastEntry.querySelector('.field-username').focus();
      return;
    }
  }

  userEntryCount++;
  const idx = userEntryCount;
  const container = $('users-container');
  const block = document.createElement('div');
  block.className = 'user-entry-block';
  block.id = `user-entry-${idx}`;
  block.innerHTML = buildUserEntryHTML(idx);
  container.appendChild(block);

  // Role buttons
  block.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      block.querySelectorAll('.role-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      const customInput = block.querySelector('.custom-role-input');
      const roleName = btn.dataset.role;

      if (btn.classList.contains('custom-role-btn')) {
        customInput.style.display = 'block';
        customInput.focus();
        block.querySelector('.role-hidden').value = 'Other';
      } else {
        customInput.style.display = 'none';
        block.querySelector('.role-hidden').value = roleName;
      }

      // Apply presets
      const preset = ROLE_PRESETS[roleName];
      if (preset) {
        block.querySelectorAll('.perm-check').forEach(c => { c.checked = false; c.indeterminate = false; });
        if (preset.all) {
          block.querySelectorAll('.perm-check').forEach(c => c.checked = true);
        } else {
          preset.categories?.forEach(cat => {
            const pCb = block.querySelector(`.perm-parent-check[data-cat="${cat}"]`);
            if (pCb) pCb.checked = true;
            block.querySelectorAll(`.perm-child-check[data-parent="${cat}"]`).forEach(c => c.checked = true);
          });
          preset.items?.forEach(item => {
            block.querySelectorAll('.perm-child-check').forEach(c => {
              if (c.nextElementSibling?.textContent?.trim() === item) c.checked = true;
            });
          });
        }
        // Sync parent-child indeterminate states naturally
        block.querySelectorAll('.perm-child-check').forEach(c => c.dispatchEvent(new Event('change')));
      }
    });
  });

  // Advanced toggle
  const toggle = block.querySelector('.advanced-toggle');
  const panel = block.querySelector('.advanced-panel');
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    panel.classList.toggle('open');
  });

  // Select all / clear
  block.querySelector('.perm-btn.select-all').addEventListener('click', () => {
    block.querySelectorAll('.perm-check').forEach(c => { c.checked = true; c.indeterminate = false; });
  });
  block.querySelector('.perm-btn.clear-all').addEventListener('click', () => {
    block.querySelectorAll('.perm-check').forEach(c => { c.checked = false; c.indeterminate = false; });
  });

  // Parent-child checkbox logic
  wirePermissionCheckboxes(block);

  // Remove button
  if (idx > 1) block.querySelector('.remove-entry-btn').style.display = 'block';
  block.querySelector('.remove-entry-btn')?.addEventListener('click', () => block.remove());
}

function buildUserEntryHTML(idx) {
  const roleHTML = ROLES.map(r =>
    `<button type="button" class="role-btn" data-role="${r}">${r}</button>`
  ).join('') + `<button type="button" class="role-btn custom-role-btn" data-role="Other">อื่นๆ</button>`;

  const permHTML = buildPermissionTreeHTML();

  return `
    <div class="form-card-header">
      <span class="card-icon">👤</span> เพิ่มผู้ใช้งานคนที่ ${idx}
      <button class="remove-entry-btn" style="display:${idx > 1 ? 'block' : 'none'}" title="ลบ">✕</button>
    </div>
    <div class="form-card-body" style="padding:20px">
      <div class="form-grid" style="margin-bottom:16px">
        <div class="form-group">
          <label class="form-label">Username <span class="required">*</span></label>
          <input type="text" class="form-input field-username" placeholder="ระบุ Username" />
        </div>
        <div class="form-group">
          <label class="form-label">อีเมล <span class="required">*</span></label>
          <input type="email" class="form-input field-email" placeholder="email@ex.com" />
        </div>
      </div>
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">บทบาท (Role) <span class="required">*</span></label>
        <div class="role-grid">${roleHTML}</div>
        <input type="text" class="form-input custom-role-input" placeholder="ระบุบทบาท..." style="display:none;margin-top:10px;border-color:#3c63e2;" />
        <input type="hidden" class="role-hidden" value="" />
      </div>
      <div class="advanced-toggle"><span>☰</span> กำหนดสิทธิ์รายเมนู (Advanced) <span class="toggle-icon" style="margin-left:auto">▲</span></div>
      <div class="advanced-panel">
        <div class="perm-toolbar">
          <button type="button" class="perm-btn select-all">เลือกทั้งหมด</button>
          <button type="button" class="perm-btn clear-all">ล้าง</button>
        </div>
        <ul class="perm-tree">${permHTML}</ul>
      </div>
    </div>
  `;
}

function buildPermissionTreeHTML() {
  return Object.entries(menuStructure).map(([cat, children]) => {
    const childrenHTML = children.map(item => {
      const name = typeof item === 'string' ? item : item.name;
      return `<li><input type="checkbox" class="perm-check perm-child-check" data-parent="${cat}" /><label>${name}</label></li>`;
    }).join('');
    return `
      <li>
        <div class="perm-parent">
          <input type="checkbox" class="perm-check perm-parent-check" data-cat="${cat}" />
          <span>${cat}</span>
        </div>
        ${children.length > 0 ? `<ul class="perm-children">${childrenHTML}</ul>` : ''}
      </li>`;
  }).join('');
}

function wirePermissionCheckboxes(block) {
  block.querySelectorAll('.perm-parent-check').forEach(parentCb => {
    parentCb.addEventListener('change', () => {
      block.querySelectorAll(`[data-parent="${parentCb.dataset.cat}"]`).forEach(c => {
        c.checked = parentCb.checked; c.indeterminate = false;
      });
    });
  });
  block.querySelectorAll('.perm-child-check').forEach(childCb => {
    childCb.addEventListener('change', () => {
      const cat = childCb.dataset.parent;
      const parentCb = block.querySelector(`.perm-parent-check[data-cat="${cat}"]`);
      if (!parentCb) return;
      const children = block.querySelectorAll(`.perm-child-check[data-parent="${cat}"]`);
      const checkedCount = [...children].filter(c => c.checked).length;
      parentCb.checked = checkedCount === children.length;
      parentCb.indeterminate = checkedCount > 0 && checkedCount < children.length;
    });
  });
}

// ── FORM SUBMIT ──────────────────────────────────────────────
async function submitForm() {
  const merchantId = $('merchant-id').value.trim();
  const merchantName = $('merchant-name').value.trim();
  const entries = document.querySelectorAll('.user-entry-block');

  $('merchant-id').classList.remove('error');
  $('merchant-name').classList.remove('error');
  if (!merchantId || !merchantName) {
    if (!merchantId) $('merchant-id').classList.add('error');
    if (!merchantName) $('merchant-name').classList.add('error');
    showToast('กรุณากรอกรหัสร้านค้าและชื่อร้านค้าให้ครบถ้วน', 'error');
    if (!merchantId) $('merchant-id').focus(); else $('merchant-name').focus();
    return;
  }

  if (entries.length === 0) { showToast('กรุณาเพิ่มผู้ใช้งานอย่างน้อย 1 คน', 'error'); return; }

  const usersData = [];
  let hasError = false;

  entries.forEach(block => {
    const username = block.querySelector('.field-username').value.trim();
    const email = block.querySelector('.field-email').value.trim();
    let role = block.querySelector('.role-hidden').value;

    const customInput = block.querySelector('.custom-role-input');
    customInput.classList.remove('error');
    if (!role) {
      block.querySelector('.role-grid').classList.add('error');
      hasError = true;
    } else if (role === 'Other') {
      role = customInput.value.trim();
      if (!role) {
        customInput.classList.add('error');
        hasError = true;
      }
    }

    block.querySelector('.field-username').classList.remove('error');
    block.querySelector('.field-email').classList.remove('error');
    if (!username) { block.querySelector('.field-username').classList.add('error'); hasError = true; }
    if (!email || !email.includes('@')) { block.querySelector('.field-email').classList.add('error'); hasError = true; }

    const permissions = {};
    let grantedCount = 0;
    block.querySelectorAll('.perm-parent-check').forEach(p => {
      const cat = p.dataset.cat;
      const childChecks = block.querySelectorAll(`.perm-child-check[data-parent="${cat}"]`);
      const selectedChildren = [...childChecks].filter(c => c.checked);
      if (p.checked || p.indeterminate || selectedChildren.length > 0) grantedCount++;
      permissions[cat] = {
        granted: p.checked || p.indeterminate || selectedChildren.length > 0,
        items: selectedChildren.map(c => c.nextElementSibling?.textContent.trim()),
      };
    });

    if (grantedCount === 0) {
      showToast('กรุณาเลือกสิทธิ์รายเมนูอย่างน้อย 1 สิทธิ์', 'error');
      hasError = true;
    }

    if (hasError) return;
    usersData.push({ username, email, role, permissions });
  });

  if (hasError) {
    if (!document.querySelector('.toast-container')?.innerHTML.includes('กรุณาเลือกสิทธิ์รายเมนู')) {
      showToast('กรุณากรอกข้อมูลและเลือกบทบาทให้ครบถ้วน', 'error');
    }
    return;
  }

  $('btn-submit-form').disabled = true;
  $('submit-text').textContent = 'กำลังบันทึก...';

  try {
    const requestData = {
      merchantId, merchantName, users: usersData,
      status: 'pending', requestedBy: 'admin@merchant.com',
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, 'user_requests'), requestData);
    showToast(`✅ ส่งคำขอสำเร็จ! (${usersData.length} คน)`, 'success');
    resetForm();
    if (isAdminAuthenticated) switchTab('history');
  } catch (e) {
    console.error('❌ Firebase submit error:', e.code, e.message);
    if (e.code === 'permission-denied') {
      showToast('⛔ ไม่มีสิทธิ์บันทึกข้อมูล — กรุณาตรวจสอบ Firestore Security Rules', 'error');
    } else {
      showToast(`❌ เกิดข้อผิดพลาด: ${e.message}`, 'error');
    }
  } finally {
    $('btn-submit-form').disabled = false;
    $('submit-text').textContent = '📤 ส่งคำขอ';
  }
}

function resetForm() {
  $('merchant-id').value = '';
  $('merchant-name').value = '';
  $('users-container').innerHTML = '';
  userEntryCount = 0;
  addUserEntry();
}

// ── HISTORY ──────────────────────────────────────────────────
function initHistory() {
  renderHistory();
  $('search-input').addEventListener('input', renderHistory);
  $('filter-status').addEventListener('change', renderHistory);
  const btnExport = $('btn-export-csv');
  if (btnExport) btnExport.addEventListener('click', exportHistoryToCSV);
}

function exportHistoryToCSV() {
  const search = $('search-input').value.toLowerCase();
  const statusFilter = $('filter-status').value;

  let filtered = allRequests.filter(r => {
    const matchStatus = !statusFilter || r.status === statusFilter;
    const matchSearch = !search || [
      r.merchantId, r.merchantName, r.requestedBy,
      ...(r.users || []).map(u => u.username + ' ' + u.email)
    ].some(v => v?.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  generateMatrixCSV(filtered, `Merchant_Requests_${new Date().toISOString().split('T')[0]}.csv`);
}

function generateMatrixCSV(requests, filename) {
  if (requests.length === 0) {
    showToast('ไม่มีข้อมูลสำหรับ Export', 'error');
    return;
  }

  let finalRows = [];
  const catsInStructure = Object.keys(menuStructure);

  requests.forEach((req, idx) => {
    if (idx > 0) finalRows.push([]); // blank line between requests

    const users = req.users || [];

    finalRows.push(['--- Merchant Information ---']);
    finalRows.push(['Batch ID', req.id]);
    finalRows.push(['Merchant ID', req.merchantId || '-']);
    finalRows.push(['Merchant Name', req.merchantName || '-']);
    finalRows.push(['Request Type', 'สร้าง User ใหม่']);
    finalRows.push([]);

    finalRows.push(['--- User Details ---']);
    finalRows.push(['User Name', ...users.map(u => u.username || '-')]);
    finalRows.push(['Role', ...users.map(u => u.role || '-')]);
    finalRows.push(['Email', ...users.map(u => u.email || '-')]);
    finalRows.push([]);

    finalRows.push(['--- Permission Access Matrix (1=Selected 0=No) ---']);

    catsInStructure.forEach(cat => {
      const catRow = [cat];
      users.forEach(u => {
        const perms = u.permissions || {};
        catRow.push(perms[cat] && perms[cat].granted ? '1' : '');
      });
      finalRows.push(catRow);

      const structItems = (menuStructure[cat] || []).map(i => typeof i === 'string' ? i : i.name);
      structItems.forEach(item => {
        const itemRow = [item];
        users.forEach(u => {
          const perms = u.permissions || {};
          const grantedItems = perms[cat] ? (perms[cat].items || []) : [];
          itemRow.push(grantedItems.includes(item) ? '1' : '');
        });
        finalRows.push(itemRow);
      });
    });
  });

  const csvContent = '\uFEFF' + finalRows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Export สำเร็จ', 'success');
}

function renderHistory() {
  const search = $('search-input').value.toLowerCase();
  const statusFilter = $('filter-status').value;

  let filtered = allRequests.filter(r => {
    const matchStatus = !statusFilter || r.status === statusFilter;
    const matchSearch = !search || [
      r.merchantId, r.merchantName, r.requestedBy,
      ...(r.users || []).map(u => u.username + ' ' + u.email)
    ].some(v => v?.toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });

  const list = $('history-list');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>ไม่พบรายการ</p></div>`;
    return;
  }

  const STATUS_LABELS = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ปฏิเสธ' };
  const STATUS_CLASSES = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };

  list.innerHTML = filtered.map(r => {
    const users = r.users || [];
    const date = r.createdAt instanceof Date
      ? r.createdAt.toLocaleString('th-TH')
      : (r.createdAt?.toDate?.()?.toLocaleString('th-TH') || '–');
    const roles = [...new Set(users.map(u => u.role).filter(Boolean))];
    const usernames = users.map(u => u.username).join(', ');

    const adminBtns = isSuperAdmin() && r.status === 'pending'
      ? `<button class="btn-approve" data-action="approved" data-id="${r.id}">✅ อนุมัติ</button>
         <button class="btn-reject" data-action="rejected" data-id="${r.id}">❌ ปฏิเสธ</button>`
      : '';

    // Build permission detail per user
    const permDetailHTML = users.map(u => {
      const perms = u.permissions || {};
      const catsInStructure = Object.keys(menuStructure);

      const grantedMenus = Object.entries(perms)
        .filter(([, v]) => v.granted)
        .sort(([catA], [catB]) => {
          const idxA = catsInStructure.indexOf(catA);
          const idxB = catsInStructure.indexOf(catB);
          return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        })
        .map(([cat, v]) => {
          const rawItems = (v.items || []).filter(Boolean);
          const structItems = (menuStructure[cat] || []).map(i => typeof i === 'string' ? i : i.name);
          const sortedItems = [...rawItems].sort((a, b) => {
            const idxA = structItems.indexOf(a);
            const idxB = structItems.indexOf(b);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
          });

          return `<div class="perm-detail-cat">
            <span class="perm-detail-cat-name">📂 ${cat}</span>
            ${sortedItems.length > 0 ? `<div class="perm-detail-items">${sortedItems.map(i => `<span class="perm-detail-item">📄 ${i}</span>`).join('')}</div>` : ''}
          </div>`;
        }).join('');

      return `<div class="perm-detail-user">
        <div class="perm-detail-user-header">👤 ${u.username} (${u.role || '–'}) · ${u.email}</div>
        ${grantedMenus || '<div class="perm-detail-empty">ไม่มีสิทธิ์ที่ขอ</div>'}
      </div>`;
    }).join('');

    return `
      <div class="request-card">
        <div class="request-card-header">
          <div class="card-avatar">${(r.merchantId || 'M').charAt(0)}</div>
          <div class="card-meta">
            <div class="card-merchant">🏪 ${r.merchantId || '–'} · ${r.merchantName || '–'}</div>
            <div class="card-user">${usernames || '–'}</div>
            <div class="card-email">โดย ${r.requestedBy || '–'}</div>
          </div>
          <span class="status-badge ${STATUS_CLASSES[r.status] || ''}">${STATUS_LABELS[r.status] || r.status}</span>
        </div>
        <div class="card-tags">
          ${roles.map(role => `<span class="card-tag">${role}</span>`).join('')}
          <span class="card-tag" style="background:#f0fff4;color:#276749">👤 ${users.length} คน</span>
        </div>
        <div class="card-info"><span>📅 ${date}</span></div>
        <div style="display:flex;gap:8px;">
          <button class="btn-toggle-perms" style="flex:1" data-id="${r.id}">🔍 ดูสิทธิ์ที่ขอ</button>
          <button class="btn-export-single" data-id="${r.id}" style="padding:6px 12px;cursor:pointer;border-radius:6px;border:1px solid #d4def7;background:#fff;color:#3c63e2;font-size:0.85rem;font-weight:600;display:flex;align-items:center;gap:4px;">📥 Export</button>
        </div>
        <div class="perm-detail-panel" id="perm-panel-${r.id}" style="display:none">
          ${permDetailHTML}
        </div>
        ${adminBtns ? `<div class="card-actions">${adminBtns}</div>` : ''}
      </div>`;
  }).join('');

  // Single export
  list.querySelectorAll('.btn-export-single').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetReq = allRequests.find(r => r.id === btn.dataset.id);
      if (targetReq) {
        const reqDate = targetReq.createdAt instanceof Date ? targetReq.createdAt : targetReq.createdAt?.toDate?.() || new Date();
        const dateStr = reqDate.toISOString().split('T')[0];
        generateMatrixCSV([targetReq], `Request_${targetReq.merchantId || 'M'}_${dateStr}.csv`);
      }
    });
  });

  // Toggle permission detail
  list.querySelectorAll('.btn-toggle-perms').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = $(`perm-panel-${btn.dataset.id}`);
      if (panel) {
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : 'block';
        btn.textContent = open ? '🔍 ดูสิทธิ์ที่ขอ' : '🔼 ซ่อนสิทธิ์';
      }
    });
  });

  // Action buttons
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      try {
        await updateDoc(doc(db, 'user_requests', id), { status: action });
      } catch (e) {
        const req = allRequests.find(r => r.id === id);
        if (req) req.status = action;
        renderHistory();
      }
      showToast(action === 'approved' ? '✅ อนุมัติแล้ว' : '❌ ปฏิเสธแล้ว', action === 'approved' ? 'success' : 'error');
    });
  });
}

// ── ADMIN PANEL ──────────────────────────────────────────────
function initAdminPanel() {
  // Add category
  $('btn-add-category').addEventListener('click', () => {
    const el = $('inline-add-category');
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    $('new-category-name').focus();
  });

  $('confirm-add-category').addEventListener('click', async () => {
    const name = $('new-category-name').value.trim();
    const ruleIdInput = $('new-category-ruleId');
    const ruleId = ruleIdInput ? ruleIdInput.value.trim() : '';
    if (!name) return;
    if (!ruleId) { showToast('กรุณาระบุ Role ID / Rule ID', 'error'); return; }
    if (menuStructure[name]) { showToast('หมวดหมู่นี้มีอยู่แล้ว', 'error'); return; }
    menuStructure[name] = [];
    categoryRules[name] = ruleId;
    await saveMenuStructure();
    $('new-category-name').value = '';
    if (ruleIdInput) ruleIdInput.value = '';
    $('inline-add-category').style.display = 'none';
    renderCategoryList();
    showToast('เพิ่มหมวดหมู่สำเร็จ', 'success');
    refreshAllPermissionTrees();
  });

  // Add menu item
  $('btn-add-menu-item').addEventListener('click', () => {
    if (!selectedCategoryForMenu) { showToast('กรุณาเลือกหมวดหมู่ก่อน', 'error'); return; }
    const el = $('inline-add-menu');
    el.style.display = el.style.display === 'none' ? 'flex' : 'none';
    $('new-menu-item-name').focus();
  });

  $('confirm-add-menu-item').addEventListener('click', async () => {
    if (!selectedCategoryForMenu) return;
    const name = $('new-menu-item-name').value.trim();
    const ruleIdInput = $('new-menu-item-ruleId');
    const ruleId = ruleIdInput ? ruleIdInput.value.trim() : '';
    if (!name) return;
    if (!ruleId) { showToast('กรุณาระบุ Role ID / Rule ID', 'error'); return; }
    if (!menuStructure[selectedCategoryForMenu]) menuStructure[selectedCategoryForMenu] = [];
    menuStructure[selectedCategoryForMenu].push({ name, ruleId });
    await saveMenuStructure();
    $('new-menu-item-name').value = '';
    if (ruleIdInput) ruleIdInput.value = '';
    $('inline-add-menu').style.display = 'none';
    renderMenuItems(selectedCategoryForMenu);
    showToast('เพิ่มรายการสำเร็จ', 'success');
    refreshAllPermissionTrees();
  });

  // Render initial
  renderCategoryList();
}

function renderCategoryList() {
  const list = $('category-list');
  if (!list) return;
  const cats = Object.keys(menuStructure);
  list.innerHTML = cats.map((cat, i) => {
    const ruleId = categoryRules[cat] || '';
    const ruleBadge = ruleId ? `<span class="rule-badge">ID: ${ruleId}</span>` : '';
    return `
    <li class="menu-item-row" draggable="true" data-cat="${cat}" data-idx="${i}" style="cursor:pointer">
      <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⠿</span>
      <span class="menu-item-label">📂 ${cat} ${ruleBadge} <button class="btn-edit-cat-rule" data-cat="${cat}" title="แก้ไข Role ID หมวดหมู่" style="background:none;border:none;cursor:pointer;font-size:12px;color:#a4b2da;margin-left:4px;">✏️</button></span>
      <button class="menu-item-delete" data-cat="${cat}" title="ลบ">✕</button>
    </li>
    `;
  }).join('');

  // Click to select
  list.querySelectorAll('li.menu-item-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.menu-item-delete') || e.target.closest('.drag-handle')) return;
      list.querySelectorAll('li').forEach(li => li.style.background = '');
      row.style.background = '#f0f4ff';
      selectedCategoryForMenu = row.dataset.cat;
      renderMenuItems(row.dataset.cat);
    });
  });

  // Edit Category Rule ID
  list.querySelectorAll('.btn-edit-cat-rule').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const currentRuleId = categoryRules[cat] || '';
      const newRuleId = await customPrompt(`กำหนด Role ID/Rule ID สำหรับหมวดหมู่ '${cat}':`, currentRuleId);
      if (newRuleId !== null) {
        if (!newRuleId.trim()) return showToast('Role/Rule ID ไม่สามารถเว้นว่างได้', 'error');
        categoryRules[cat] = newRuleId.trim();
        await saveMenuStructure();
        renderCategoryList();
        showToast('อัปเดต Role ID สำเร็จ', 'success');
      }
    });
  });

  // Delete
  list.querySelectorAll('.menu-item-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      delete menuStructure[btn.dataset.cat];
      delete categoryRules[btn.dataset.cat];
      await saveMenuStructure();
      renderCategoryList();
      $('menu-items-list').innerHTML = '';
      selectedCategoryForMenu = null;
      showToast('ลบหมวดหมู่สำเร็จ', 'success');
      refreshAllPermissionTrees();
    });
  });

  // Init Drag & Drop for categories
  initDragDrop(list, 'data-cat', async (dragCat, dropCat) => {
    const keys = Object.keys(menuStructure);
    const dragIdx = keys.indexOf(dragCat);
    const dropIdx = keys.indexOf(dropCat);
    if (dragIdx === -1 || dropIdx === -1 || dragIdx === dropIdx) return;

    keys.splice(dragIdx, 1);
    keys.splice(dropIdx, 0, dragCat);

    const reordered = {};
    keys.forEach(k => { reordered[k] = menuStructure[k]; });
    menuStructure = reordered;
    await saveMenuStructure();
    renderCategoryList();
    showToast('จัดลำดับหมวดหมู่สำเร็จ', 'success');
    refreshAllPermissionTrees();
  });
}

function renderMenuItems(cat) {
  const items = menuStructure[cat] || [];
  const list = $('menu-items-list');
  list.innerHTML = `<div class="menu-cat-header">📂 ${cat}</div>` +
    items.map((item, i) => {
      const name = typeof item === 'string' ? item : item.name;
      const ruleId = typeof item === 'string' ? '' : (item.ruleId || '');
      const ruleBadge = ruleId ? `<span class="rule-badge">ID: ${ruleId}</span>` : '';
      return `
      <li class="menu-item-row" draggable="true" data-idx="${i}">
        <span class="drag-handle" title="ลากเพื่อจัดลำดับ">⠿</span>
        <span class="menu-item-label">📄 ${name} ${ruleBadge} <button class="btn-edit-rule" data-cat="${cat}" data-idx="${i}" title="แก้ไข Role ID" style="background:none;border:none;cursor:pointer;font-size:12px;color:#a4b2da;margin-left:4px;">✏️</button></span>
        <button class="menu-item-delete" data-cat="${cat}" data-idx="${i}" title="ลบ">✕</button>
      </li>
      `;
    }).join('');

  // Edit Rule ID
  list.querySelectorAll('.btn-edit-rule').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const c = btn.dataset.cat;
      const idx = parseInt(btn.dataset.idx);
      const item = menuStructure[c][idx];
      const name = typeof item === 'string' ? item : item.name;
      const currentRuleId = typeof item === 'string' ? '' : (item.ruleId || '');

      const newRuleId = await customPrompt(`กำหนด Role ID/Rule ID สำหรับ '${name}':`, currentRuleId);
      if (newRuleId !== null) {
        if (!newRuleId.trim()) return showToast('Role/Rule ID ไม่สามารถเว้นว่างได้', 'error');
        menuStructure[c][idx] = { name, ruleId: newRuleId.trim() };
        await saveMenuStructure();
        renderMenuItems(c);
        showToast('อัปเดต Role ID สำเร็จ', 'success');
        refreshAllPermissionTrees();
      }
    });
  });

  // Delete
  list.querySelectorAll('.menu-item-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      menuStructure[btn.dataset.cat].splice(parseInt(btn.dataset.idx), 1);
      await saveMenuStructure();
      renderMenuItems(btn.dataset.cat);
      showToast('ลบรายการสำเร็จ', 'success');
      refreshAllPermissionTrees();
    });
  });

  // Init Drag & Drop for items
  initDragDrop(list, 'data-idx', async (dragIdxStr, dropIdxStr) => {
    const dragIdx = parseInt(dragIdxStr);
    const dropIdx = parseInt(dropIdxStr);
    const arr = menuStructure[cat];
    if (isNaN(dragIdx) || isNaN(dropIdx) || dragIdx === dropIdx) return;

    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(dropIdx, 0, moved);

    await saveMenuStructure();
    renderMenuItems(cat);
    showToast('จัดลำดับรายการสำเร็จ', 'success');
    refreshAllPermissionTrees();
  });
}

// ── DRAG AND DROP EXTRACTED LOGIC ─────────────────────────────
function initDragDrop(container, dataAttribute, onDropReorder) {
  let draggedDatasetValue = null;
  let draggedEl = null;

  container.querySelectorAll('li[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedDatasetValue = row.getAttribute(dataAttribute);
      draggedEl = row;
      e.dataTransfer.effectAllowed = 'move';
      // Firefox requires setting data to drag
      e.dataTransfer.setData('text/plain', draggedDatasetValue);
      setTimeout(() => row.classList.add('dragging'), 0);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedDatasetValue = null;
      draggedEl = null;
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault(); // Necessary to allow dropping
      if (!draggedEl || draggedEl === row) return;

      // Calculate drop position (before or after)
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      container.querySelectorAll('li').forEach(el => el.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const dropDatasetValue = row.getAttribute(dataAttribute);

      if (draggedDatasetValue !== null && dropDatasetValue !== null && draggedDatasetValue !== dropDatasetValue) {
        onDropReorder(draggedDatasetValue, dropDatasetValue);
      }
    });
  });
}

function refreshAllPermissionTrees() {
  document.querySelectorAll('.user-entry-block').forEach(block => {
    const panel = block.querySelector('.advanced-panel');
    if (!panel) return;
    panel.querySelector('.perm-tree').innerHTML = buildPermissionTreeHTML();
    wirePermissionCheckboxes(block);
  });
}

// ── REORDER HELPER ────────────────────────────────────────────
function reorderObjectKey(obj, key, direction) {
  const keys = Object.keys(obj);
  const idx = keys.indexOf(key);
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= keys.length) return obj;
  [keys[idx], keys[newIdx]] = [keys[newIdx], keys[idx]];
  const reordered = {};
  keys.forEach(k => { reordered[k] = obj[k]; });
  return reordered;
}

// ── ROLES ADMIN ────────────────────────────────────────────────
let currentEditingRole = null;

// Called once on app init to wire up all static buttons in the Role Preset card
function initRoleAdminPanel() {
  $('btn-add-role')?.addEventListener('click', async () => {
    const roleName = await customPrompt('ระบุชื่อบทบาทใหม่');
    if (roleName && !ROLES.includes(roleName)) {
      ROLES.push(roleName);
      ROLE_PRESETS[roleName] = {};
      saveMenuStructure();
      renderRoleAdminList();
    } else if (roleName) {
      showToast('บทบาทนี้มีอยู่แล้ว', 'error');
    }
  });

  $('close-role-editor')?.addEventListener('click', () => {
    $('role-preset-editor').style.display = 'none';
    currentEditingRole = null;
  });

  $('preset-select-all')?.addEventListener('click', () => {
    $('preset-perm-tree')?.querySelectorAll('.perm-check').forEach(c => { c.checked = true; c.indeterminate = false; });
  });

  $('preset-clear-all')?.addEventListener('click', () => {
    $('preset-perm-tree')?.querySelectorAll('.perm-check').forEach(c => { c.checked = false; c.indeterminate = false; });
  });

  $('save-role-preset')?.addEventListener('click', () => {
    if (!currentEditingRole) return;
    const tree = $('preset-perm-tree');
    const totalChecks = tree.querySelectorAll('.perm-check');
    const checkedCount = [...totalChecks].filter(c => c.checked).length;
    const description = $('role-preset-description')?.value.trim() || '';

    if (checkedCount === totalChecks.length && totalChecks.length > 0) {
      ROLE_PRESETS[currentEditingRole] = { all: true, description };
    } else {
      const newPreset = { categories: [], items: [], description };
      tree.querySelectorAll('.perm-parent-check').forEach(p => {
        if (p.checked) newPreset.categories.push(p.dataset.cat);
      });
      tree.querySelectorAll('.perm-child-check').forEach(c => {
        const cat = c.dataset.parent;
        const parentCb = tree.querySelector(`.perm-parent-check[data-cat="${cat}"]`);
        if (c.checked && (!parentCb || !parentCb.checked)) {
          newPreset.items.push(c.nextElementSibling?.textContent?.trim());
        }
      });
      ROLE_PRESETS[currentEditingRole] = newPreset;
    }
    saveMenuStructure();
    showToast('บันทึกสิทธิ์ตั้งต้นสำเร็จ', 'success');
    $('role-preset-editor').style.display = 'none';
    currentEditingRole = null;
    renderRoleAdminList();
  });

  $('delete-role-btn')?.addEventListener('click', async () => {
    if (!currentEditingRole) return;
    const conf = await customPrompt(`พิมพ์ DELETE เพื่อยืนยันลบบทบาท "${currentEditingRole}"`);
    if (conf === 'DELETE') {
      const idx = ROLES.indexOf(currentEditingRole);
      if (idx !== -1) ROLES.splice(idx, 1);
      delete ROLE_PRESETS[currentEditingRole];
      saveMenuStructure();
      showToast('ลบบทบาทสำเร็จ', 'success');
      $('role-preset-editor').style.display = 'none';
      currentEditingRole = null;
      renderRoleAdminList();
    }
  });
}

// Called every time roles data updates - only renders the list rows
function renderRoleAdminList() {
  const list = $('role-list');
  if (!list) return;

  list.innerHTML = ROLES.map(role => `
    <li data-role="${role}" class="menu-item-row" draggable="true" style="cursor:default;">
      <span class="drag-handle">⠿</span>
      <div style="flex:1; display:flex; align-items:center; gap:8px;">
        <span class="item-name">👑 ${role}</span>
        ${ROLE_PRESETS[role]?.all ? '<span class="status-badge status-approved" style="padding:2px 6px;font-size:0.7rem;margin-left:auto;">All Access</span>' : ''}
      </div>
      <div class="item-actions">
        <button class="btn-action btn-edit-role-preset" data-role="${role}">✏️ แก้ไขสิทธิ์</button>
      </div>
    </li>
  `).join('');

  // Bind edit buttons for dynamically created list items
  list.querySelectorAll('.btn-edit-role-preset').forEach(btn => {
    btn.addEventListener('click', () => openRolePresetEditor(btn.dataset.role));
  });

  // Drag-and-drop reorder
  initDragDrop(list, 'data-role', (draggedValue, dropValue) => {
    const dragIdx = ROLES.indexOf(draggedValue);
    const dropIdx = ROLES.indexOf(dropValue);
    if (dragIdx === -1 || dropIdx === -1) return;
    const [moved] = ROLES.splice(dragIdx, 1);
    ROLES.splice(dropIdx, 0, moved);
    saveMenuStructure();
    renderRoleAdminList();
  });
}

function openRolePresetEditor(role) {
  currentEditingRole = role;
  $('editing-role-title').textContent = `แก้ไขสิทธิ์ของ: ${role}`;
  $('preset-perm-tree').innerHTML = buildPermissionTreeHTML();
  $('role-preset-editor').style.display = 'block';
  // Load saved description
  const descEl = $('role-preset-description');
  if (descEl) descEl.value = ROLE_PRESETS[role]?.description || '';

  const preset = ROLE_PRESETS[role] || {};
  const tree = $('preset-perm-tree');
  tree.querySelectorAll('.perm-check').forEach(c => { c.checked = false; c.indeterminate = false; });
  if (preset.all) {
    tree.querySelectorAll('.perm-check').forEach(c => c.checked = true);
  } else {
    preset.categories?.forEach(cat => {
      const pCb = tree.querySelector(`.perm-parent-check[data-cat="${cat}"]`);
      if (pCb) pCb.checked = true;
      tree.querySelectorAll(`.perm-child-check[data-parent="${cat}"]`).forEach(c => c.checked = true);
    });
    preset.items?.forEach(item => {
      tree.querySelectorAll('.perm-child-check').forEach(c => {
        if (c.nextElementSibling?.textContent?.trim() === item) c.checked = true;
      });
    });
  }
  wirePermissionCheckboxes($('role-preset-editor'));
  tree.querySelectorAll('.perm-child-check').forEach(c => c.dispatchEvent(new Event('change')));
}

// ── TOAST ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-msg">${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}
