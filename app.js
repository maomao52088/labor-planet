/**
 * Labor Planet (劳动星球) — app.js
 * Single-page application core logic
 * Architecture: localStorage as shared KV store (all students share same origin)
 * AI: calls OpenAI-compatible chat API — user must configure API_KEY in settings
 *
 * Data model (localStorage keys, all prefixed by classCode):
 *  lp_{cls}_students         → { [nick]: { pin, char, exp, tasks, calendar, badges, petFed, chests, bossRecord } }
 *  lp_{cls}_feed             → [ FeedItem, … ]   (latest 50)
 *  lp_{cls}_announcements    → [ AnnItem, … ]     (latest 30)
 *  lp_{cls}_teacher_pin      → "4-digit string"
 *  lp_{cls}_team_goal        → { week, count, target }
 */

'use strict';

/* ============================================================
   CONFIGURATION — edit AI_BASE_URL & AI_MODEL if needed
   Leave AI_KEY empty; user will be prompted the first time.
   ============================================================ */
const AI_BASE_URL = 'https://api.openai.com/v1';
const AI_MODEL    = 'gpt-4o-mini';

/* ============================================================
   CONSTANTS
   ============================================================ */
const BASE_LEVELS = [
  { threshold: 0,   emoji: '⛺', name: '营地',  label: '第1阶段：营地' },
  { threshold: 80,  emoji: '🏠', name: '小屋',  label: '第2阶段：小屋' },
  { threshold: 200, emoji: '🌾', name: '农田',  label: '第3阶段：农田' },
  { threshold: 380, emoji: '🗼', name: '瞭望塔', label: '第4阶段：瞭望塔' },
  { threshold: 600, emoji: '🏰', name: '城堡',  label: '第5阶段：城堡' },
  { threshold: 900, emoji: '⛲', name: '许愿池', label: '第6阶段：许愿池' },
];

const PET_STAGES = [
  { minFed: 0,  emoji: '🥚', name: '守护蛋',   desc: '原始宠物蛋' },
  { minFed: 5,  emoji: '🐣', name: '雏兽',     desc: '破壳而出的小生命' },
  { minFed: 15, emoji: '🐾', name: '成长兽',   desc: '正茁壮成长中' },
  { minFed: 30, emoji: '🐉', name: '守护神兽', desc: '最终进化形态，威震星际！' },
];

const CHAR_EMOJI = {
  '矿工小队长': '⛏️',
  '农场守护者': '🌾',
  '建筑大师':   '🪚',
  '苔原小怪':   '👾',
};

const CHEST_TYPES = [
  { name: '木箱',   emoji: '📦', weight: 60, multiplier: 1.0 },
  { name: '金箱',   emoji: '🎁', weight: 30, multiplier: 1.5 },
  { name: '钻石箱', emoji: '💎', weight: 10, multiplier: 2.0 },
];

const BADGES_DEF = [
  { id: 'first_task',    emoji: '🌱', name: '初出茅庐',   desc: '完成第一次任务',      check: s => s.tasks >= 1 },
  { id: 'task_10',       emoji: '⭐', name: '劳动新星',   desc: '累计完成10次任务',    check: s => s.tasks >= 10 },
  { id: 'task_30',       emoji: '🌟', name: '劳动达人',   desc: '累计完成30次任务',    check: s => s.tasks >= 30 },
  { id: 'streak_3',      emoji: '🔥', name: '三日连击',   desc: '连续3天完成任务',     check: s => calcStreak(s) >= 3 },
  { id: 'streak_7',      emoji: '💫', name: '七日传说',   desc: '连续7天完成任务',     check: s => calcStreak(s) >= 7 },
  { id: 'boss_first',    emoji: '👹', name: 'Boss猎手',   desc: '完成第一次Boss任务',  check: s => (s.bossCompleted||0) >= 1 },
  { id: 'boss_3',        emoji: '🏆', name: '传说领袖',   desc: '完成3次Boss任务',     check: s => (s.bossCompleted||0) >= 3 },
  { id: 'diamond_chest', emoji: '💎', name: '钻石幸运儿', desc: '开出钻石箱',          check: s => (s.chests?.diamond||0) >= 1 },
  { id: 'pet_final',     emoji: '🐉', name: '神兽养成师', desc: '伙伴进化至最终形态',  check: s => (s.petFed||0) >= 30 },
];

const FALLBACK_TASKS = [
  { name: '洗碗', mission: '清洗神器，守护星球餐厅！', exp: 15, tip: '先浸泡5分钟，油污更容易去除；最后用热水冲淋，洁净闪亮！' },
  { name: '擦桌子', mission: '消灭尘埃怪，守护冒险营地！', exp: 12, tip: '用湿抹布顺纹理擦拭，最后用干布吸走水分，不留水痕！' },
  { name: '扫地', mission: '出击！清除地面暗藏的敌人碎片！', exp: 14, tip: '从内向外、从上到下扫，最后归拢到中心，一次性扫进簸箕！' },
  { name: '整理房间', mission: '重新规划星球建筑布局！', exp: 20, tip: '先分类再整理：衣物→书籍→杂物，每样归位！' },
  { name: '浇花', mission: '激活星球生命力泵，灌溉绿色盟友！', exp: 10, tip: '在根部缓慢浇水，避免叶片上留水，早晚各浇一次效果最佳！' },
  { name: '倒垃圾', mission: '清除星球废料基地，守护环境安全！', exp: 10, tip: '垃圾袋口扎紧，避免臭气扩散；归来记得洗手！' },
  { name: '拖地', mission: '发动全面清洁战，消灭隐形污染源！', exp: 18, tip: '拖把湿度控七成，顺着光线从里到外拖，不留死角！' },
  { name: '洗衣服', mission: '激活星球洗涤协议，净化战袍！', exp: 22, tip: '深浅色分开洗；领口袖口先重点预处理，洗衣液不要超量！' },
];

/* ============================================================
   STATE
   ============================================================ */
let state = {
  nick: null,
  pin: null,
  char: null,
  classCode: 'default',
  teacherUnlocked: false,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  // pending chest data
  pendingChest: null,
  // 10-min timer
  loginTime: null,
  limitShown: false,
  apiKey: null,
};

/* ============================================================
   STORAGE HELPERS
   ============================================================ */
function pfx(key) { return `lp_${state.classCode}_${key}`; }

function getStudents() {
  try { return JSON.parse(localStorage.getItem(pfx('students')) || '{}'); } catch { return {}; }
}
function saveStudents(obj) { localStorage.setItem(pfx('students'), JSON.stringify(obj)); }

function getMyProfile() {
  const all = getStudents();
  return all[state.nick] || null;
}
function saveMyProfile(profile) {
  const all = getStudents();
  all[state.nick] = profile;
  saveStudents(all);
}

function getFeed() {
  try { return JSON.parse(localStorage.getItem(pfx('feed')) || '[]'); } catch { return []; }
}
function saveFeed(arr) {
  const trimmed = arr.slice(0, 50);
  localStorage.setItem(pfx('feed'), JSON.stringify(trimmed));
}

function getAnnouncements() {
  try { return JSON.parse(localStorage.getItem(pfx('announcements')) || '[]'); } catch { return []; }
}
function saveAnnouncements(arr) {
  localStorage.setItem(pfx('announcements'), JSON.stringify(arr.slice(0, 30)));
}

function getTeacherPin() { return localStorage.getItem(pfx('teacher_pin')) || null; }
function setTeacherPin(pin) { localStorage.setItem(pfx('teacher_pin'), pin); }

function getTeamGoal() {
  try {
    const raw = localStorage.getItem(pfx('team_goal'));
    const obj = raw ? JSON.parse(raw) : null;
    const thisWeek = getWeekKey();
    if (!obj || obj.week !== thisWeek) {
      const fresh = { week: thisWeek, count: 0, target: 50 };
      localStorage.setItem(pfx('team_goal'), JSON.stringify(fresh));
      return fresh;
    }
    return obj;
  } catch { return { week: getWeekKey(), count: 0, target: 50 }; }
}
function saveTeamGoal(obj) { localStorage.setItem(pfx('team_goal'), JSON.stringify(obj)); }

function getApiKey() {
  return state.apiKey || localStorage.getItem('lp_api_key') || '';
}
function setApiKey(k) {
  state.apiKey = k;
  localStorage.setItem('lp_api_key', k);
}

/* ============================================================
   DATE / WEEK HELPERS
   ============================================================ */
function getWeekKey() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}年${parseInt(m)}月${parseInt(d)}日`;
}

function calcStreak(profile) {
  const cal = profile.calendar || {};
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (cal[k] && cal[k] > 0) streak++;
    else break;
  }
  return streak;
}

/* ============================================================
   LEVEL / EXP HELPERS
   ============================================================ */
const LEVEL_THRESHOLDS = [0, 80, 200, 380, 600, 900, 1300, 1800, 2400, 3100, 4000];

function expToLevel(exp) {
  let lv = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (exp >= LEVEL_THRESHOLDS[i]) lv = i + 1;
    else break;
  }
  return lv;
}

function nextLevelExp(exp) {
  const lv = expToLevel(exp);
  return LEVEL_THRESHOLDS[lv] ?? null;
}

function baseLevel(exp) {
  for (let i = BASE_LEVELS.length - 1; i >= 0; i--) {
    if (exp >= BASE_LEVELS[i].threshold) return BASE_LEVELS[i];
  }
  return BASE_LEVELS[0];
}

function petStage(fed) {
  for (let i = PET_STAGES.length - 1; i >= 0; i--) {
    if (fed >= PET_STAGES[i].minFed) return PET_STAGES[i];
  }
  return PET_STAGES[0];
}

/* ============================================================
   CHEST ROLL
   ============================================================ */
function rollChest() {
  const r = Math.random() * 100;
  let acc = 0;
  for (const c of CHEST_TYPES) {
    acc += c.weight;
    if (r < acc) return c;
  }
  return CHEST_TYPES[0];
}

/* ============================================================
   AI CALLS
   ============================================================ */
async function aiChat(systemPrompt, userMsg) {
  let key = getApiKey();
  if (!key) {
    key = prompt('请输入你的 OpenAI API Key（将保存在本地浏览器）：');
    if (!key) return null;
    setApiKey(key.trim());
  }
  const resp = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.85,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`API Error ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? null;
}

async function aiTranslateTask(housework, isBoss = false) {
  const profile = getMyProfile();
  const sys = isBoss
    ? `你是一个充满气势的星际冒险任务生成AI。用户是一名${profile?.char||'探险家'}。请把用户输入的大型家务翻译成一个霸气的Boss级冒险任务名（15字以内），给出40到120之间的经验值整数，以及一条专业清洁大挑战技巧（30字以内）。严格按以下JSON格式输出，不要有其他文字：{"name":"任务名","exp":80,"tip":"操作技巧"}`
    : `你是一个温暖的星际冒险任务生成AI。用户是一名${profile?.char||'探险家'}。请把用户输入的家务翻译成一个有趣的冒险任务名（15字以内），给出10到30之间的经验值整数，以及一条具体可执行的操作小技巧（30字以内）。严格按以下JSON格式输出，不要有其他文字：{"name":"任务名","exp":15,"tip":"操作技巧"}`;
  const raw = await aiChat(sys, housework);
  const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
  return json;
}

async function aiEncouragement(nick, char, level, chestName, taskName) {
  const sys = `你是一个温暖活泼的AI伙伴，专门给小朋友劳动后提供个性化鼓励。请根据信息生成一句不超过40字的鼓励语，语气活泼正向，结尾可以加一个emoji。不要出现"失败"、"落后"等负面词汇。`;
  const msg = `玩家昵称：${nick}，角色：${char}，等级：${level}，完成任务：${taskName}，开出：${chestName}`;
  try {
    return await aiChat(sys, msg) || `太棒了，${nick}！你的努力让星球变得更美好！✨`;
  } catch {
    return `太棒了，${nick}！你的努力让星球变得更美好！✨`;
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
}

/* ============================================================
   INIT — DOM Ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initLogin();
  initAnnouncements();
  initTeacherZone();
  initStatus();
  initTasks();
  initBase();
  initFeed();
  initClass();
  initNav();
  initModals();
});

/* ============================================================
   LOGIN
   ============================================================ */
function initLogin() {
  // Character selection
  document.querySelectorAll('#char-grid .char-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#char-grid .char-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      opt.querySelector('input').checked = true;
    });
  });

  document.getElementById('login-form').addEventListener('submit', e => {
    e.preventDefault();
    handleLogin();
  });
}

function handleLogin() {
  const nick = document.getElementById('inp-nick').value.trim();
  const pin  = document.getElementById('inp-pin').value.trim();
  const char = document.querySelector('#char-grid input[type=radio]:checked')?.value || '矿工小队长';
  const cls  = document.getElementById('inp-class').value.trim() || 'default';
  const errEl = document.getElementById('login-error');

  errEl.textContent = '';
  errEl.classList.add('hidden');

  if (!nick) { showLoginError('请填写探险家昵称！'); return; }
  if (!/^\d{4}$/.test(pin)) { showLoginError('口令必须是4位数字！'); return; }

  state.classCode = cls;

  const students = getStudents();
  if (students[nick]) {
    // existing user — verify pin
    if (students[nick].pin !== pin) {
      showLoginError('口令错误，请重新输入！');
      return;
    }
    // update char if changed
    students[nick].char = char;
    saveStudents(students);
  } else {
    // new user — register
    students[nick] = {
      pin, char, exp: 0, tasks: 0,
      calendar: {}, badges: [], petFed: 0,
      chests: { wood: 0, gold: 0, diamond: 0 },
      bossRecord: {}, bossCompleted: 0,
      todayTasks: [],
    };
    saveStudents(students);
  }

  state.nick = nick;
  state.pin  = pin;
  state.char = char;
  state.loginTime = Date.now();
  state.limitShown = false;

  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  bootstrapApp();

  // 10-min soft limiter
  setTimeout(() => {
    if (!state.limitShown) {
      state.limitShown = true;
      document.getElementById('time-limit-modal').classList.remove('hidden');
    }
  }, 10 * 60 * 1000);
}

function showLoginError(msg) {
  const errEl = document.getElementById('login-error');
  errEl.textContent = msg;
  errEl.classList.remove('hidden');
}

/* ============================================================
   BOOTSTRAP (after login)
   ============================================================ */
function bootstrapApp() {
  updateHeader();
  renderAnnouncements();
  renderStatusTab();
  renderTaskTab();
  renderBaseTab();
  renderFeed();
  renderClassTab();
  checkAndShowBanner();
}

/* ============================================================
   HEADER
   ============================================================ */
function updateHeader() {
  const p = getMyProfile();
  if (!p) return;
  const lv  = expToLevel(p.exp);
  const nxt = nextLevelExp(p.exp) ?? p.exp;
  const prevLvExp = LEVEL_THRESHOLDS[lv - 1] ?? 0;
  const pct = nxt > prevLvExp ? Math.min(100, ((p.exp - prevLvExp) / (nxt - prevLvExp)) * 100) : 100;

  document.getElementById('hd-avatar').textContent  = CHAR_EMOJI[p.char] || '⛏️';
  document.getElementById('hd-nick').textContent     = state.nick;
  document.getElementById('hd-level').textContent    = `Lv.${lv}`;
  document.getElementById('hd-exp-bar').style.width  = `${pct}%`;
  document.getElementById('hd-exp-text').textContent = `${p.exp}/${nxt} EXP`;

  document.getElementById('btn-logout').addEventListener('click', handleLogout);
}

function handleLogout() {
  state.nick = null; state.pin = null; state.char = null;
  state.teacherUnlocked = false;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('inp-nick').value = '';
  document.getElementById('inp-pin').value  = '';
}

/* ============================================================
   TAB NAVIGATION
   ============================================================ */
function initNav() {
  document.querySelectorAll('#app-nav .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#app-nav .nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById(target)?.classList.add('active');
      // Refresh on tab switch
      if (target === 'tab-class')   renderClassTab();
      if (target === 'tab-feed')    renderFeed();
      if (target === 'tab-status')  renderStatusTab();
      if (target === 'tab-base')    renderBaseTab();
      if (target === 'tab-tasks')   renderTaskTab();
      if (target === 'tab-announce') renderAnnouncements();
    });
  });
}

/* ============================================================
   ANNOUNCEMENT BANNER
   ============================================================ */
function checkAndShowBanner() {
  const anns = getAnnouncements();
  const homework = anns.find(a => a.type === '作业' && a.date === todayKey());
  if (homework) {
    document.getElementById('ann-banner-icon').textContent = '📝';
    document.getElementById('ann-banner-text').textContent = `今日作业：${homework.content}`;
    document.getElementById('ann-banner').classList.remove('hidden');
    document.body.classList.add('has-banner');
  }
  document.getElementById('ann-banner-close').addEventListener('click', () => {
    document.getElementById('ann-banner').classList.add('hidden');
    document.body.classList.remove('has-banner');
  });
}

/* ============================================================
   ANNOUNCEMENTS TAB
   ============================================================ */
function initAnnouncements() {
  // ann-type changes → show/hide date picker
  document.getElementById('ann-type').addEventListener('change', function () {
    document.getElementById('ann-date-wrap').style.display = this.value === '作业' ? 'flex' : 'none';
  });
  // default: show date
  document.getElementById('ann-date-wrap').style.display = 'flex';
  // set default date to today
  document.getElementById('ann-date').value = todayKey();

  document.getElementById('ann-form').addEventListener('submit', e => {
    e.preventDefault();
    publishAnnouncement();
  });
}

function initTeacherZone() {
  document.getElementById('btn-teacher-zone').addEventListener('click', () => {
    const panel = document.getElementById('teacher-panel');
    if (state.teacherUnlocked) {
      panel.classList.toggle('hidden');
      return;
    }
    document.getElementById('teacher-auth-card').classList.remove('hidden');
  });

  document.getElementById('btn-teacher-cancel').addEventListener('click', () => {
    document.getElementById('teacher-auth-card').classList.add('hidden');
    document.getElementById('teacher-pin-inp').value = '';
    document.getElementById('teacher-auth-error').classList.add('hidden');
  });

  document.getElementById('btn-teacher-unlock').addEventListener('click', () => {
    const pin = document.getElementById('teacher-pin-inp').value.trim();
    const errEl = document.getElementById('teacher-auth-error');
    if (!/^\d{4}$/.test(pin)) {
      errEl.textContent = '请输入4位数字口令！'; errEl.classList.remove('hidden'); return;
    }
    const stored = getTeacherPin();
    if (!stored) {
      // first time — set
      setTeacherPin(pin);
    } else if (stored !== pin) {
      errEl.textContent = '口令错误！'; errEl.classList.remove('hidden'); return;
    }
    state.teacherUnlocked = true;
    document.getElementById('teacher-auth-card').classList.add('hidden');
    document.getElementById('teacher-panel').classList.remove('hidden');
    errEl.classList.add('hidden');
    showToast('👑 老师专区已解锁！');
  });

  document.getElementById('btn-teacher-lock').addEventListener('click', () => {
    state.teacherUnlocked = false;
    document.getElementById('teacher-panel').classList.add('hidden');
    showToast('🔒 老师专区已锁定');
  });
}

function publishAnnouncement() {
  const type    = document.getElementById('ann-type').value;
  const content = document.getElementById('ann-content').value.trim();
  const dateVal = type === '作业' ? document.getElementById('ann-date').value : null;

  if (!content) { showToast('请填写公告内容！'); return; }

  const item = {
    id: Date.now().toString(),
    type, content, date: dateVal,
    time: new Date().toISOString(),
    publisher: state.nick,
  };
  const anns = getAnnouncements();
  anns.unshift(item);
  saveAnnouncements(anns);
  document.getElementById('ann-content').value = '';
  renderAnnouncements();
  checkAndShowBanner();
  showToast('📢 公告已发布！');
}

function renderAnnouncements() {
  const list = document.getElementById('ann-list');
  const anns = getAnnouncements();
  if (!anns.length) {
    list.innerHTML = '<p class="empty-hint">暂无公告，等待老师发布…</p>';
    return;
  }
  list.innerHTML = anns.map(a => {
    const dateTag = a.type === '作业' && a.date
      ? `<span class="ann-date-tag">📅 ${fmtDate(a.date)}</span>`
      : '';
    const time = new Date(a.time);
    const timeStr = `${time.getMonth()+1}/${time.getDate()} ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
    return `<div class="ann-item">
      <div class="ann-item-header">
        <span class="ann-type-badge badge-${a.type}">${annTypeIcon(a.type)} ${a.type}</span>
        ${dateTag}
        <span class="ann-time-tag">${timeStr}</span>
      </div>
      <div class="ann-content">${escapeHtml(a.content)}</div>
    </div>`;
  }).join('');
}

function annTypeIcon(type) {
  return type === '作业' ? '📝' : type === '鼓励' ? '💖' : '📢';
}

/* ============================================================
   STATUS TAB
   ============================================================ */
function initStatus() {
  document.getElementById('cal-prev').addEventListener('click', () => {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });
}

function renderStatusTab() {
  const p = getMyProfile();
  if (!p) return;

  // Pet
  const ps = petStage(p.petFed || 0);
  document.getElementById('pet-emoji').textContent  = ps.emoji;
  document.getElementById('pet-stage').textContent  = ps.name;
  document.getElementById('pet-fed').textContent    = p.petFed || 0;

  // Stats
  document.getElementById('st-exp').textContent     = p.exp || 0;
  document.getElementById('st-chests').textContent  = ((p.chests?.wood||0) + (p.chests?.gold||0) + (p.chests?.diamond||0));
  document.getElementById('st-chest-detail').textContent = `${p.chests?.wood||0}/${p.chests?.gold||0}/${p.chests?.diamond||0}`;
  document.getElementById('st-tasks').textContent   = p.tasks || 0;
  document.getElementById('st-streak').textContent  = calcStreak(p);

  renderCalendar();
}

function renderCalendar() {
  const p = getMyProfile();
  if (!p) return;
  const year = state.calYear, month = state.calMonth;
  document.getElementById('cal-title').textContent = `${year}年${month+1}月`;

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date();

  const grid = document.getElementById('cal-grid');
  let html = '';

  // Blank cells for offset
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day other-month"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count = p.calendar?.[key] || 0;
    const isDone  = count > 0;
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    html += `<div class="cal-day${isDone?' done':''}${isToday?' today':''}">
      <span class="cal-day-num">${d}</span>
      ${isDone ? `<span class="cal-day-count">${count}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

/* ============================================================
   TASK TAB
   ============================================================ */
function initTasks() {
  document.getElementById('btn-translate').addEventListener('click', handleTranslate);
  document.getElementById('hw-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleTranslate();
  });
}

async function handleTranslate() {
  const input = document.getElementById('hw-input').value.trim();
  if (!input) { showToast('请先输入家务内容！'); return; }

  const loading = document.getElementById('translate-loading');
  const btn = document.getElementById('btn-translate');
  loading.classList.remove('hidden');
  btn.disabled = true;

  try {
    let result;
    try {
      result = await aiTranslateTask(input, false);
    } catch {
      // Fallback
      const fb = FALLBACK_TASKS.find(t => input.includes(t.name)) || FALLBACK_TASKS[Math.floor(Math.random() * FALLBACK_TASKS.length)];
      result = { name: fb.mission, exp: fb.exp, tip: fb.tip };
    }

    // Detect if it's a homework task today
    const anns = getAnnouncements();
    const hasHomework = anns.some(a => a.type === '作业' && a.date === todayKey());
    const isHomework = hasHomework;

    addTask({ name: result.name, baseExp: result.exp, tip: result.tip, isHomework, raw: input });
    document.getElementById('hw-input').value = '';
    renderTaskTab();
    showToast('✨ 冒险任务已创建！');
  } catch (err) {
    showToast('任务翻译失败，请检查API Key或网络');
  } finally {
    loading.classList.add('hidden');
    btn.disabled = false;
  }
}

function addTask(task) {
  const p = getMyProfile();
  if (!p) return;
  const id = `task_${Date.now()}`;
  if (!p.todayTasks) p.todayTasks = [];
  p.todayTasks.unshift({ id, ...task, done: false, createdAt: new Date().toISOString() });
  saveMyProfile(p);
}

function renderTaskTab() {
  renderBossArea();
  const p = getMyProfile();
  if (!p) return;
  const list = document.getElementById('task-list');
  const tasks = (p.todayTasks || []).slice(0, 20); // show up to 20
  if (!tasks.length) {
    list.innerHTML = '<p class="empty-hint">还没有任务，去上方翻译一件家务吧！</p>';
    return;
  }
  list.innerHTML = tasks.map(t => renderTaskCard(t)).join('');
  // Bind open chest buttons
  list.querySelectorAll('.btn-open-chest').forEach(btn => {
    btn.addEventListener('click', () => openChestForTask(btn.dataset.id));
  });
  // Bind tip toggles
  list.querySelectorAll('.task-tip-toggle').forEach(tog => {
    tog.addEventListener('click', () => {
      const tipEl = tog.nextElementSibling;
      if (tipEl) tipEl.classList.toggle('hidden');
      tog.textContent = tipEl.classList.contains('hidden') ? '🔍 查看操作技巧' : '🙈 收起技巧';
    });
  });
}

function renderTaskCard(t) {
  const expLabel = `${t.baseExp} EXP`;
  const typeTag  = t.isHomework ? `<span class="task-type-tag">📝 作业任务</span>` : '';
  if (t.done) {
    return `<div class="task-card done">
      <div class="task-card-header">
        <span class="task-name">✅ ${escapeHtml(t.name)}</span>
        <span class="task-exp-badge">${expLabel}</span>
        ${typeTag}
      </div>
      <div class="task-done-label">✔ 已完成，劳动记录已保存！</div>
    </div>`;
  }
  return `<div class="task-card" id="tc_${t.id}">
    <div class="task-card-header">
      <span class="task-name">⚔️ ${escapeHtml(t.name)}</span>
      <span class="task-exp-badge">${expLabel}</span>
      ${typeTag}
    </div>
    <span class="task-tip-toggle">🔍 查看操作技巧</span>
    <div class="task-tip-text hidden">${escapeHtml(t.tip||'认真完成就是最大的技巧！')}</div>
    <button class="btn btn-success btn-sm mt-2 btn-open-chest" data-id="${t.id}" style="width:100%">📦 完成！开宝箱</button>
  </div>`;
}

function openChestForTask(taskId) {
  const p = getMyProfile();
  if (!p) return;
  const task = (p.todayTasks || []).find(t => t.id === taskId);
  if (!task || task.done) return;

  const chest = rollChest();
  const now   = new Date();
  const earlyBird = task.isHomework && now.getHours() < 21;

  state.pendingChest = { taskId, task, chest, earlyBird };

  // Show modal
  document.getElementById('chest-modal-title').textContent = `${chest.emoji} 神秘宝箱出现了！`;
  document.getElementById('chest-anim').textContent = chest.emoji;
  document.getElementById('chest-task-name').textContent = `任务：${task.name}`;
  document.getElementById('chest-base-exp').textContent  = task.baseExp;
  const eb = document.getElementById('chest-early-bird');
  eb.classList.toggle('hidden', !earlyBird);
  document.getElementById('chest-result').classList.add('hidden');
  document.getElementById('btn-open-chest').classList.remove('hidden');
  document.getElementById('chest-modal').classList.remove('hidden');
}

async function collectChestReward() {
  const { taskId, task, chest, earlyBird } = state.pendingChest;
  const finalExp = Math.round(task.baseExp * chest.multiplier) + (earlyBird ? 20 : 0);

  const p = getMyProfile();
  if (!p) return;

  // Mark task done
  const taskObj = (p.todayTasks || []).find(t => t.id === taskId);
  if (taskObj) taskObj.done = true;

  // Add exp
  p.exp = (p.exp || 0) + finalExp;
  p.tasks = (p.tasks || 0) + 1;
  p.petFed = (p.petFed || 0) + 1;

  // Calendar
  const tk = todayKey();
  if (!p.calendar) p.calendar = {};
  p.calendar[tk] = (p.calendar[tk] || 0) + 1;

  // Chest stats
  if (!p.chests) p.chests = { wood:0, gold:0, diamond:0 };
  if (chest.name === '木箱')    p.chests.wood++;
  else if (chest.name === '金箱') p.chests.gold++;
  else if (chest.name === '钻石箱') p.chests.diamond++;

  // Badges
  p.badges = checkBadges(p);

  // Boss completed count (if this task was boss)
  if (task.isBoss) p.bossCompleted = (p.bossCompleted || 0) + 1;

  saveMyProfile(p);

  // Team goal
  const goal = getTeamGoal();
  goal.count++;
  saveTeamGoal(goal);

  // Feed item
  const all = getStudents();
  const feedItem = {
    id: `feed_${Date.now()}`,
    nick: state.nick,
    char: p.char,
    taskName: task.name,
    rawHousework: task.raw || '',
    chest: chest.name, chestEmoji: chest.emoji,
    exp: finalExp, earlyBird,
    time: new Date().toISOString(),
    likes: [],
    comments: [],
  };
  const feed = getFeed();
  feed.unshift(feedItem);
  saveFeed(feed);

  // Update header
  updateHeader();
  renderTaskTab();
  renderStatusTab();

  // AI encouragement (async, don't block)
  const lv = expToLevel(p.exp);
  aiEncouragement(state.nick, p.char, lv, chest.name, task.name)
    .then(quote => {
      document.getElementById('chest-ai-text').textContent = quote;
    })
    .catch(() => {
      document.getElementById('chest-ai-text').textContent = `太棒了，${state.nick}！你的劳动让星球更闪耀！✨`;
    });

  showToast(`🎉 获得 ${finalExp} EXP！`);
  document.getElementById('btn-collect').classList.remove('hidden');
}

/* ============================================================
   BOSS TASK
   ============================================================ */
function renderBossArea() {
  const p = getMyProfile();
  if (!p) return;
  const area = document.getElementById('boss-area');
  const week = getWeekKey();
  const record = (p.bossRecord || {})[week];

  if (record && record.done) {
    area.innerHTML = `<div class="boss-card">
      <div class="task-card-header">
        <span class="task-name">✅ ${escapeHtml(record.name)}</span>
        <span class="task-exp-badge">${record.exp} EXP</span>
      </div>
      <div class="task-done-label">✔ 本周Boss任务已完成，下周再战！</div>
    </div>`;
    return;
  }

  if (record && !record.done) {
    area.innerHTML = `<div class="boss-card">
      <div class="task-card-header">
        <span class="task-name">👹 ${escapeHtml(record.name)}</span>
        <span class="task-exp-badge">${record.exp} EXP</span>
      </div>
      <span class="task-tip-toggle">🔍 查看Boss秘籍</span>
      <div class="task-tip-text hidden">${escapeHtml(record.tip)}</div>
      <button class="btn btn-danger btn-sm mt-2 btn-open-boss-chest" style="width:100%">📦 Boss已击败！开宝箱</button>
    </div>`;
    area.querySelector('.task-tip-toggle')?.addEventListener('click', function() {
      const t = this.nextElementSibling;
      if (t) t.classList.toggle('hidden');
    });
    area.querySelector('.btn-open-boss-chest')?.addEventListener('click', () => {
      openChestForBossTask(record);
    });
    return;
  }

  // No boss yet this week
  const launchBtn = document.createElement('button');
  launchBtn.className = 'btn btn-danger btn-full';
  launchBtn.textContent = '⚔️ 迎击本周BOSS任务！';
  launchBtn.addEventListener('click', handleLaunchBoss);
  area.innerHTML = '';
  area.appendChild(launchBtn);

  const input = document.createElement('input');
  input.type = 'text'; input.maxLength = 30;
  input.placeholder = '描述一件大任务，例如: 大扫除、整理阁楼…';
  input.className = 'mt-2'; input.id = 'boss-input';
  input.style.width = '100%';
  area.prepend(input);
}

async function handleLaunchBoss() {
  const input = document.getElementById('boss-input');
  const hw = (input?.value || '').trim() || '家庭大扫除';
  const p  = getMyProfile();
  if (!p) return;
  const week = getWeekKey();
  const record = (p.bossRecord || {})[week];
  if (record) { showToast('本周已发起Boss任务！'); return; }

  const btn = document.querySelector('.btn-danger.btn-full');
  if (btn) btn.disabled = true;

  try {
    let result;
    try {
      result = await aiTranslateTask(hw, true);
    } catch {
      result = { name: `消灭星球超级污染怪：${hw}`, exp: 80, tip: '分区域、分步骤逐一击破，每完成一块给自己点个赞！' };
    }
    if (!p.bossRecord) p.bossRecord = {};
    p.bossRecord[week] = { name: result.name, exp: result.exp, tip: result.tip, done: false, raw: hw };
    saveMyProfile(p);
    renderBossArea();
    showToast('👹 Boss任务已发起！全力迎战！');
  } catch {
    showToast('Boss任务创建失败，请重试');
    if (btn) btn.disabled = false;
  }
}

function openChestForBossTask(record) {
  const chest = rollChest();
  state.pendingChest = {
    taskId: `boss_${getWeekKey()}`,
    task: { name: record.name, baseExp: record.exp, tip: record.tip, isHomework: false, isBoss: true },
    chest, earlyBird: false,
    isBoss: true,
  };
  document.getElementById('chest-modal-title').textContent = `👹 BOSS战胜利！开宝箱！`;
  document.getElementById('chest-anim').textContent = '👹';
  document.getElementById('chest-task-name').textContent = `Boss任务：${record.name}`;
  document.getElementById('chest-base-exp').textContent  = record.exp;
  document.getElementById('chest-early-bird').classList.add('hidden');
  document.getElementById('chest-result').classList.add('hidden');
  document.getElementById('btn-open-chest').classList.remove('hidden');
  document.getElementById('chest-modal').classList.remove('hidden');
}

/* ============================================================
   BADGE CHECK
   ============================================================ */
function checkBadges(profile) {
  const current = new Set(profile.badges || []);
  const newBadge = [];
  for (const b of BADGES_DEF) {
    if (b.check(profile)) {
      if (!current.has(b.id)) newBadge.push(b.id);
      current.add(b.id);
    }
  }
  if (newBadge.length) {
    const names = newBadge.map(id => BADGES_DEF.find(b => b.id === id)?.name).filter(Boolean);
    setTimeout(() => showToast(`🏅 解锁新徽章：${names.join('、')}！`), 500);
  }
  return [...current];
}

/* ============================================================
   BASE TAB
   ============================================================ */
function renderBaseTab() {
  const p = getMyProfile();
  if (!p) return;
  const bl = baseLevel(p.exp);
  document.getElementById('base-emoji').textContent = bl.emoji;
  document.getElementById('base-name').textContent  = bl.label;

  const nextIdx = BASE_LEVELS.findIndex(l => l.threshold > p.exp);
  const hint = nextIdx >= 0
    ? `距离【${BASE_LEVELS[nextIdx].name}】还需 ${BASE_LEVELS[nextIdx].threshold - p.exp} EXP`
    : '🎉 已达最高阶段！';
  document.getElementById('base-next-hint').textContent = hint;

  // Timeline
  const tl = document.getElementById('base-timeline');
  tl.innerHTML = BASE_LEVELS.map(l => {
    const isUnlocked = p.exp >= l.threshold;
    const isCurrent  = bl.threshold === l.threshold;
    return `<div class="base-step ${isUnlocked ? 'unlocked' : ''} ${isCurrent ? 'current' : ''}">
      <span class="step-emoji">${l.emoji}</span>
      <span>${l.name}</span>
      <small>${l.threshold}+</small>
    </div>`;
  }).join('');

  // Badges
  renderBadgeWall(p);
}

function renderBadgeWall(p) {
  const wall = document.getElementById('badge-wall');
  const unlockedSet = new Set(p.badges || []);
  wall.innerHTML = BADGES_DEF.map(b => {
    const unlocked = unlockedSet.has(b.id);
    return `<div class="badge-item ${unlocked ? 'unlocked' : ''}">
      <span class="badge-emoji">${b.emoji}</span>
      <span class="badge-name">${b.name}</span>
      <span class="badge-desc">${b.desc}</span>
    </div>`;
  }).join('');
}

/* ============================================================
   FEED TAB
   ============================================================ */
function renderFeed() {
  const feedList = document.getElementById('feed-list');
  const feed = getFeed();
  if (!feed.length) {
    feedList.innerHTML = '<p class="empty-hint">还没有动态，完成一次任务开宝箱就会自动发布！</p>';
    return;
  }
  feedList.innerHTML = feed.map(item => renderFeedCard(item)).join('');

  // Bind like buttons
  feedList.querySelectorAll('.like-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleLike(btn.dataset.fid));
  });
  // Bind comment toggles
  feedList.querySelectorAll('.comment-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = document.getElementById(`cs_${btn.dataset.fid}`);
      if (section) section.classList.toggle('hidden');
    });
  });
  // Bind comment sends
  feedList.querySelectorAll('.send-comment-btn').forEach(btn => {
    btn.addEventListener('click', () => sendComment(btn.dataset.fid));
  });
  feedList.querySelectorAll('.comment-inp').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendComment(inp.dataset.fid);
    });
  });
}

function renderFeedCard(item) {
  const feed = getFeed();
  // Re-fetch item from storage (likes may have updated)
  const fresh = feed.find(f => f.id === item.id) || item;
  const likes = fresh.likes || [];
  const liked = likes.includes(state.nick);
  const chestTagClass = `chest-tag-${fresh.chest}`;
  const earlyTag = fresh.earlyBird ? `<span style="font-size:0.72rem;color:var(--col-gold-dk);font-weight:bold;">⏰ 早鸟奖励</span>` : '';
  const charEmoji = CHAR_EMOJI[fresh.char] || '⛏️';
  const time = new Date(fresh.time);
  const timeStr = `${time.getMonth()+1}/${time.getDate()} ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
  const comments = (fresh.comments || []);
  const commHtml = comments.length
    ? comments.map(c => `<div class="comment-item"><span class="comment-author">${escapeHtml(c.nick)}</span>：${escapeHtml(c.text)}</div>`).join('')
    : '<div class="comment-item" style="color:var(--col-hint)">暂无留言，来第一个鼓励吧！</div>';

  return `<div class="feed-card" id="fc_${fresh.id}">
    <div class="feed-card-top">
      <span class="feed-avatar">${charEmoji}</span>
      <div class="feed-meta">
        <div class="feed-nick">${escapeHtml(fresh.nick)} <span class="feed-role">${escapeHtml(fresh.char||'')}</span></div>
        <div class="feed-time">${timeStr}</div>
      </div>
    </div>
    <div class="feed-content">完成了冒险任务：<strong>「${escapeHtml(fresh.taskName)}」</strong> 🎉</div>
    <div class="feed-chest-row">
      <span class="chest-tag ${chestTagClass}">${fresh.chestEmoji} ${fresh.chest}</span>
      <span class="exp-gained-tag">+${fresh.exp} EXP</span>
      ${earlyTag}
    </div>
    <div class="feed-actions">
      <button class="like-btn ${liked?'liked':''}" data-fid="${fresh.id}">
        ${liked?'❤️':'🤍'} <span class="like-count">${likes.length}</span>
      </button>
      <button class="comment-toggle-btn" data-fid="${fresh.id}">💬 ${comments.length}条留言</button>
    </div>
    <div class="comment-section hidden" id="cs_${fresh.id}">
      <div class="comment-list">${commHtml}</div>
      <div class="comment-input-row">
        <input class="comment-inp" type="text" maxlength="50" placeholder="说一句鼓励的话…" data-fid="${fresh.id}" />
        <button class="btn btn-blue btn-sm send-comment-btn" data-fid="${fresh.id}">发送</button>
      </div>
    </div>
  </div>`;
}

function toggleLike(fid) {
  const feed = getFeed();
  const item = feed.find(f => f.id === fid);
  if (!item) return;
  if (!item.likes) item.likes = [];
  const idx = item.likes.indexOf(state.nick);
  if (idx >= 0) item.likes.splice(idx, 1);
  else item.likes.push(state.nick);
  saveFeed(feed);
  renderFeed();
}

function sendComment(fid) {
  const inp = document.querySelector(`.comment-inp[data-fid="${fid}"]`);
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) { showToast('请先写点什么！'); return; }
  const feed = getFeed();
  const item = feed.find(f => f.id === fid);
  if (!item) return;
  if (!item.comments) item.comments = [];
  item.comments.push({ nick: state.nick, text, time: new Date().toISOString() });
  saveFeed(feed);
  inp.value = '';
  renderFeed();
  // Re-open comment section
  setTimeout(() => {
    const cs = document.getElementById(`cs_${fid}`);
    if (cs) cs.classList.remove('hidden');
  }, 50);
}

/* ============================================================
   CLASS TAB
   ============================================================ */
function renderClassTab() {
  renderTeamGoal();
  renderRaceTracks();
}

function renderTeamGoal() {
  const goal = getTeamGoal();
  const pct  = Math.min(100, (goal.count / goal.target) * 100);
  document.getElementById('team-cur').textContent  = goal.count;
  document.getElementById('team-goal').textContent = goal.target;
  document.getElementById('team-progress').style.width = `${pct}%`;
  const victory = document.getElementById('team-victory');
  if (goal.count >= goal.target) victory.classList.remove('hidden');
  else victory.classList.add('hidden');
}

function renderRaceTracks() {
  const tracks = document.getElementById('race-tracks');
  const students = getStudents();
  const entries = Object.entries(students).map(([nick, data]) => ({ nick, exp: data.exp || 0, char: data.char || '矿工小队长' }));
  if (!entries.length) {
    tracks.innerHTML = '<p class="empty-hint">等待班级同学加入…</p>';
    return;
  }
  entries.sort((a,b) => b.exp - a.exp);
  const maxExp = Math.max(...entries.map(e => e.exp), 100);

  tracks.innerHTML = entries.map(e => {
    const pct = Math.min(90, (e.exp / maxExp) * 90);
    const isMe = e.nick === state.nick;
    return `<div class="race-lane" style="${isMe ? 'border-color:var(--col-gold);background:rgba(232,160,32,0.08)' : ''}">
      <div class="race-lane-header">
        <span class="race-nick">${isMe ? '⭐' : ''}${escapeHtml(e.nick)} ${CHAR_EMOJI[e.char]||'⛏️'}</span>
        <span class="race-exp">${e.exp} EXP</span>
      </div>
      <div class="race-track">
        <span class="race-runner" style="left:${pct}%">${CHAR_EMOJI[e.char]||'⛏️'}</span>
        <span class="race-finish-flag">🏁</span>
      </div>
    </div>`;
  }).join('');
}

/* ============================================================
   MODALS
   ============================================================ */
function initModals() {
  // Chest modal
  document.getElementById('btn-open-chest').addEventListener('click', async () => {
    const { task, chest, earlyBird } = state.pendingChest;
    const finalExp = Math.round(task.baseExp * chest.multiplier) + (earlyBird ? 20 : 0);

    const anim = document.getElementById('chest-anim');
    anim.style.animation = 'none'; // reset
    void anim.offsetWidth;
    anim.style.animation = '';

    document.getElementById('chest-type-name').textContent = `${chest.emoji} ${chest.name}`;
    document.getElementById('chest-mult').textContent       = `x${chest.multiplier}`;
    document.getElementById('chest-final-exp').textContent  = finalExp;
    document.getElementById('chest-ai-text').textContent   = '正在生成鼓励寄语…';
    document.getElementById('btn-open-chest').classList.add('hidden');
    document.getElementById('chest-result').classList.remove('hidden');

    // Now save and award
    await collectChestReward();
    // Mark boss as done if applicable
    if (state.pendingChest.isBoss) {
      const p = getMyProfile();
      const week = getWeekKey();
      if (p?.bossRecord?.[week]) {
        p.bossRecord[week].done = true;
        p.bossCompleted = (p.bossCompleted || 0) + 1;
        p.badges = checkBadges(p);
        saveMyProfile(p);
        renderBossArea();
      }
    }
  });

  document.getElementById('btn-collect').addEventListener('click', () => {
    document.getElementById('chest-modal').classList.add('hidden');
    renderTaskTab();
    renderFeed();
    renderClassTab();
    updateHeader();
  });

  // Time limit modal
  document.getElementById('btn-dismiss-limit').addEventListener('click', () => {
    document.getElementById('time-limit-modal').classList.add('hidden');
  });
  document.getElementById('btn-logout-limit').addEventListener('click', () => {
    document.getElementById('time-limit-modal').classList.add('hidden');
    handleLogout();
  });

  // Close modals on overlay click (but not card)
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });
}

/* ============================================================
   UTILS
   ============================================================ */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
