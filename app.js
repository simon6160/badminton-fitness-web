/**
 * 羽球員體適能訓練管理網站 — 主應用程式邏輯（v2 多週自動排程版）
 * 特色：
 * 1. 免帳號密碼（輸入名字即用）
 * 2. 自動換週 ＋ 4 週漸進循環（W1 適應 → W2 基礎 → W3 強化 → W4 檢測 → 自動循環）
 * 3. 每週球員打卡、疲勞與疼痛紀錄獨立歸檔，支援跨週歷史查詢
 * 4. 本機儲存 ＋ 免費 Google 試算表雙模式雲端同步
 */
(function () {
  const DATA = window.BADMINTON_DATA;
  const CFG = window.TEAM_CONFIG || {};
  const STORAGE_KEY = 'badminton_fitness_state_v2';
  const LEGACY_V1_KEY = 'badminton_fitness_state_v1';
  const USER_KEY = 'badminton_fitness_last_user_v1';
  const CLOUD_URL_KEY = 'badminton_fitness_cloud_url_v1';
  const THEME_KEY = 'badminton_fitness_theme_v1';

  const TODAY_WEEK_KEY = DATA.getMondayIso(new Date());

  function getTodayDayId() {
    const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return map[new Date().getDay()] || 'mon';
  }

  function formatShortDate(d = new Date()) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${m}/${day}`;
  }

  function formatFullDate(d = new Date()) {
    return `${d.getFullYear()}/${formatShortDate(d)}`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // =========================================================================
  // 1. v2 多週資料模型建立與 v1 自動遷移
  // =========================================================================
  function createFreshState() {
    const anchor = TODAY_WEEK_KEY;
    const w0 = DATA.buildWeekObject(anchor, 'w2', null, true);
    // 預設同時自動預排下 1 週，讓教練與球員馬上能預覽下週自動排程
    const nextWeekKey = DATA.addWeeksToIso(anchor, 1);
    const w1 = DATA.buildWeekObject(nextWeekKey, DATA.computeAutoPhase(anchor, nextWeekKey, 'w2'), null, true);

    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      cycleAnchorWeek: anchor,
      cycleAnchorPhase: 'w2',
      weeks: {
        [anchor]: w0,
        [nextWeekKey]: w1
      },
      players: DATA.createDefaultPlayers(anchor)
    };
  }

  // 將舊版 v1 單週資料無痛遷移為 v2 多週架構
  function migrateV1ToV2(v1) {
    const anchor = TODAY_WEEK_KEY;
    const phase = v1.weekPhase || 'w2';
    const currentWeek = DATA.buildWeekObject(anchor, phase, v1.weeklyPlan || null, false);
    const nextWeekKey = DATA.addWeeksToIso(anchor, 1);
    const nextWeek = DATA.buildWeekObject(nextWeekKey, DATA.computeAutoPhase(anchor, nextWeekKey, phase), null, true);

    const players = (v1.players || []).map(p => ({
      id: p.id,
      name: p.name,
      level: p.level || 'varsity',
      weeklyLogs: p.weeklyLogs || { [anchor]: p.logs || {} },
      weeklyCheckins: p.weeklyCheckins || { [anchor]: p.checkins || {} },
      fitnessTests: p.fitnessTests || []
    }));

    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      cycleAnchorWeek: anchor,
      cycleAnchorPhase: phase,
      weeks: {
        [anchor]: currentWeek,
        [nextWeekKey]: nextWeek
      },
      players: players.length ? players : DATA.createDefaultPlayers(anchor)
    };
  }

  function loadLocalState() {
    try {
      const rawV2 = localStorage.getItem(STORAGE_KEY);
      if (rawV2) {
        const parsed = JSON.parse(rawV2);
        if (parsed && parsed.version === 2 && parsed.weeks && Array.isArray(parsed.players)) {
          return parsed;
        }
      }
      const rawV1 = localStorage.getItem(LEGACY_V1_KEY);
      if (rawV1) {
        const parsedV1 = JSON.parse(rawV1);
        if (parsedV1 && Array.isArray(parsedV1.weeklyPlan)) {
          const migrated = migrateV1ToV2(parsedV1);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }
    } catch (err) {
      console.warn('讀取本機資料失敗，改用預設多週課表：', err);
    }
    return createFreshState();
  }

  // 核心自動化函式：存取任意週次時，若尚未建立則自動依 4 週漸進循環產生
  function ensureWeekExists(weekKey, autoPersist = true) {
    if (!db.weeks) db.weeks = {};
    if (!db.weeks[weekKey]) {
      const anchor = db.cycleAnchorWeek || TODAY_WEEK_KEY;
      const anchorPhase = db.cycleAnchorPhase || 'w2';
      const autoPhase = DATA.computeAutoPhase(anchor, weekKey, anchorPhase);
      db.weeks[weekKey] = DATA.buildWeekObject(weekKey, autoPhase, null, true);
      if (autoPersist) persistState(true);
    }
    return db.weeks[weekKey];
  }

  let db = loadLocalState();
  // 開啟網站時自動確保「今天所在的真實週次」一定存在（跨週自動排程！）
  ensureWeekExists(TODAY_WEEK_KEY, false);

  let ui = {
    activeTab: 'player',
    weekKey: TODAY_WEEK_KEY,
    dayId: getTodayDayId(),
    currentPlayerId: '',
    isCoachMode: false,
    coachUnlocked: !CFG.COACH_PASSCODE,
    coachViewPlayerId: '',
    coachCatFilter: '全部',
    analyticsPlayerId: '',
    trendMetric: 'broadJump',
    histWeek: 'all',
    histDay: 'all',
    histCat: '全部',
    histStatus: 'all'
  };

  let cloudSyncTimer = null;

  function getCloudUrl() {
    const custom = (localStorage.getItem(CLOUD_URL_KEY) || '').trim();
    return custom || (CFG.CLOUD_API_URL || '').trim();
  }

  function persistState(autoSyncCloud = true) {
    db.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (err) {
      console.warn('儲存 localStorage 失敗：', err);
    }
    if (autoSyncCloud && getCloudUrl()) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = setTimeout(() => {
        pushToCloud(true);
      }, 900);
    }
  }

  async function pullFromCloud(silent = false) {
    const url = getCloudUrl();
    if (!url) return false;
    setSyncBadge('同步中...', 'badge-mid');
    try {
      const res = await fetch(url, { method: 'GET' });
      const json = await res.json();
      if (json && json.ok && json.data) {
        if (json.data.version === 2 && json.data.weeks) {
          db = json.data;
        } else if (Array.isArray(json.data.weeklyPlan)) {
          db = migrateV1ToV2(json.data);
        } else {
          setSyncBadge('雲端尚無資料', 'badge-mid');
          return false;
        }
        ensureWeekExists(TODAY_WEEK_KEY, false);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        ensureValidPlayerSelection();
        renderQuickPlayerChips();
        renderAll();
        setSyncBadge('雲端已同步', 'badge-low');
        if (!silent) showToast('已從 Google 試算表下載最新全隊多週資料！');
        return true;
      }
      setSyncBadge('雲端尚無資料', 'badge-mid');
      if (!silent) showToast('雲端目前為空白，請點擊「上傳本機資料至雲端」初始化。');
      return false;
    } catch (err) {
      console.error('雲端下載失敗：', err);
      setSyncBadge('雲端連線失敗（使用本機）', 'badge-high');
      if (!silent) showToast('無法連線至雲端網址，請確認 Apps Script 已設為「所有人」存取。');
      return false;
    }
  }

  async function pushToCloud(silent = false) {
    const url = getCloudUrl();
    if (!url) return false;
    setSyncBadge('上傳中...', 'badge-mid');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveAll', data: db })
      });
      const json = await res.json();
      if (json && json.ok) {
        setSyncBadge('雲端已同步', 'badge-low');
        if (!silent) showToast('已成功將多週課表與訓練紀錄同步至 Google 試算表！');
        return true;
      }
      throw new Error(json?.error || '雲端回傳錯誤');
    } catch (err) {
      console.error('雲端上傳失敗：', err);
      setSyncBadge('同步失敗（已保存本機）', 'badge-high');
      if (!silent) showToast('上傳雲端失敗，資料已安全保存於本機。');
      return false;
    }
  }

  function setSyncBadge(text, badgeClass) {
    const pill = document.getElementById('syncStatusPill');
    if (pill) {
      pill.textContent = text;
      pill.className = `badge ${badgeClass}`;
    }
    const entryNote = document.getElementById('entrySyncBadge');
    if (entryNote) {
      entryNote.textContent = getCloudUrl()
        ? `☁️ 團隊雲端同步已啟用（${text}）`
        : '💾 目前為零設定本機儲存模式（支援每週自動換週與 4 週漸進循環）';
    }
    const syncBtn = document.getElementById('manualSyncBtn');
    if (syncBtn) syncBtn.classList.toggle('hidden', !getCloudUrl());
  }

  // =========================================================================
  // 2. 多週資料查詢與統計輔助函式
  // =========================================================================
  function getSortedWeekKeys() {
    return Object.keys(db.weeks || {}).sort();
  }

  function getActiveWeek() {
    return ensureWeekExists(ui.weekKey, false);
  }

  function getPlayerById(id) {
    return db.players.find(p => p.id === id) || db.players[0];
  }

  function getDayById(dayId, weekObj = getActiveWeek()) {
    return (weekObj.days || []).find(d => d.dayId === dayId) || weekObj.days[0];
  }

  function getWeekExercises(weekObj = getActiveWeek()) {
    return (weekObj.days || []).flatMap(d =>
      d.exercises.map(ex => ({
        ...ex,
        weekKey: weekObj.weekKey,
        weekLabel: weekObj.weekLabel,
        weekPhase: weekObj.phase,
        dayId: d.dayId,
        dateLabel: d.dateLabel,
        shortName: d.shortName
      }))
    );
  }

  function getPlayerWeekLogs(player, weekKey = ui.weekKey) {
    player.weeklyLogs = player.weeklyLogs || {};
    if (!player.weeklyLogs[weekKey]) player.weeklyLogs[weekKey] = {};
    return player.weeklyLogs[weekKey];
  }

  function getPlayerWeekCheckins(player, weekKey = ui.weekKey) {
    player.weeklyCheckins = player.weeklyCheckins || {};
    if (!player.weeklyCheckins[weekKey]) player.weeklyCheckins[weekKey] = {};
    return player.weeklyCheckins[weekKey];
  }

  function getAdjustedSets(baseSets, levelId, phaseId) {
    if (baseSets <= 1) return 1;
    const phaseDelta = (DATA.WEEK_PHASES[phaseId] || DATA.WEEK_PHASES.w2).setDelta;
    const levelDelta = (DATA.LEVELS[levelId] || DATA.LEVELS.varsity).setDelta;
    return Math.max(2, baseSets + phaseDelta + levelDelta);
  }

  function getPlayerWeeklyRate(player, weekKey = ui.weekKey) {
    const weekObj = ensureWeekExists(weekKey, false);
    const all = getWeekExercises(weekObj);
    if (!all.length || !player) return 0;
    const logs = (player.weeklyLogs && player.weeklyLogs[weekKey]) || {};
    const done = all.filter(ex => logs[ex.id]?.completed).length;
    return Math.round((done / all.length) * 100);
  }

  function getPlayerTotalCompletedAllWeeks(player) {
    let total = 0;
    Object.values(player.weeklyLogs || {}).forEach(weekMap => {
      Object.values(weekMap || {}).forEach(rec => {
        if (rec && rec.completed) total += 1;
      });
    });
    return total;
  }

  function getPlayerDayStats(player, day, weekKey = ui.weekKey) {
    const total = day.exercises.length;
    const logs = (player.weeklyLogs && player.weeklyLogs[weekKey]) || {};
    const done = day.exercises.filter(ex => logs[ex.id]?.completed).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function getPlayerPainAlerts(player, weekKey = ui.weekKey) {
    const list = [];
    const weekObj = ensureWeekExists(weekKey, false);
    const cks = (player.weeklyCheckins && player.weeklyCheckins[weekKey]) || {};
    Object.entries(cks).forEach(([dayId, ck]) => {
      if (ck && ck.hasPain) {
        const d = getDayById(dayId, weekObj);
        list.push({
          day: d ? d.shortName : dayId,
          parts: ck.painParts || [],
          desc: ck.painDesc || ''
        });
      }
    });
    return list;
  }

  function getRelativeWeekTag(weekKey) {
    const diff = DATA.diffWeeksBetween(TODAY_WEEK_KEY, weekKey);
    if (diff === 0) return '本週';
    if (diff === 1) return '下週';
    if (diff === -1) return '上週';
    return diff > 0 ? `+${diff}週` : `${diff}週`;
  }

  function intensityBadgeClass(intensity) {
    if (intensity === '高') return 'badge-high';
    if (intensity === '低') return 'badge-low';
    return 'badge-mid';
  }

  function ensureValidPlayerSelection() {
    if (!db.players.length) {
      db.players = DATA.createDefaultPlayers(TODAY_WEEK_KEY);
    }
    if (!db.players.some(p => p.id === ui.currentPlayerId)) {
      ui.currentPlayerId = db.players[0].id;
    }
    if (!db.players.some(p => p.id === ui.coachViewPlayerId)) {
      ui.coachViewPlayerId = ui.currentPlayerId;
    }
    if (!db.players.some(p => p.id === ui.analyticsPlayerId)) {
      ui.analyticsPlayerId = ui.currentPlayerId;
    }
  }

  function findOrCreatePlayerByName(rawName, preferredLevel = 'varsity') {
    const name = rawName.trim();
    const existing = db.players.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) return existing;

    const newPlayer = {
      id: `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      level: preferredLevel,
      weeklyLogs: {},
      weeklyCheckins: {},
      fitnessTests: []
    };
    db.players.push(newPlayer);
    persistState(true);
    return newPlayer;
  }

  // =========================================================================
  // 3. Toast 與主題控制
  // =========================================================================
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀️ 淺色' : '🌙 深色';
    if (ui.activeTab === 'analytics') requestAnimationFrame(drawCharts);
  }

  // =========================================================================
  // 4. 免登入「輸入名字」入口
  // =========================================================================
  function renderQuickPlayerChips() {
    const box = document.getElementById('quickPlayerChips');
    if (!box) return;
    box.innerHTML = db.players.map(p => {
      const lv = (DATA.LEVELS[p.level] || DATA.LEVELS.varsity).label.split('／')[0];
      return `<button type="button" class="player-chip" data-quick-pid="${escapeHtml(p.id)}">${escapeHtml(p.name)} <span class="muted text-xs">(${lv})</span></button>`;
    }).join('');

    box.querySelectorAll('button[data-quick-pid]').forEach(btn => {
      btn.addEventListener('click', () => enterAppAsPlayer(btn.dataset.quickPid));
    });
  }

  function enterAppAsPlayer(playerId, startTab = 'player') {
    const player = getPlayerById(playerId);
    ui.currentPlayerId = player.id;
    ui.coachViewPlayerId = player.id;
    ui.analyticsPlayerId = player.id;
    ui.isCoachMode = startTab === 'coach';
    localStorage.setItem(USER_KEY, JSON.stringify({ playerId: player.id, isCoach: ui.isCoachMode }));

    document.getElementById('entryScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    switchTab(startTab);
    renderAll();
  }

  function openEntryScreen() {
    renderQuickPlayerChips();
    document.getElementById('entryNameInput').value = '';
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('entryScreen').classList.remove('hidden');
  }

  function switchTab(tab) {
    if (tab === 'coach' && CFG.COACH_PASSCODE && !ui.coachUnlocked) {
      const entered = window.prompt('請輸入教練管理端簡易密碼：');
      if (entered !== String(CFG.COACH_PASSCODE)) {
        showToast('密碼不正確，維持目前頁面。');
        return;
      }
      ui.coachUnlocked = true;
    }

    ui.activeTab = tab;
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    ['player', 'coach', 'analytics', 'sync'].forEach(t => {
      document.getElementById(`section-${t}`).classList.toggle('hidden', t !== tab);
    });
    if (tab === 'analytics') requestAnimationFrame(drawCharts);
  }

  function goToWeek(targetWeekKey, notifyAuto = false) {
    const existed = Boolean(db.weeks[targetWeekKey]);
    const wk = ensureWeekExists(targetWeekKey, true);
    ui.weekKey = targetWeekKey;
    renderAll();
    if (!existed && notifyAuto) {
      const ph = DATA.WEEK_PHASES[wk.phase]?.shortLabel || wk.phase;
      showToast(`已自動排定 ${wk.weekLabel} 課表（自動循環：${ph}）！`);
    }
  }

  // =========================================================================
  // 5. 全域控制列與週次選擇器同步
  // =========================================================================
  function syncGlobalControls() {
    const teamName = CFG.TEAM_NAME || '羽球專項體適能訓練中心';
    document.getElementById('entryTeamTitle').textContent = teamName;
    document.getElementById('headerTeamTitle').textContent = teamName;

    const currentPlayer = getPlayerById(ui.currentPlayerId);
    const activeWeek = getActiveWeek();

    document.getElementById('currentUserBadge').textContent = ui.isCoachMode
      ? `教練模式（檢視：${currentPlayer.name}）`
      : `${currentPlayer.name}（${(DATA.LEVELS[currentPlayer.level] || DATA.LEVELS.varsity).label}）`;

    // 週次下拉選單
    const weekKeys = getSortedWeekKeys();
    const weekSel = document.getElementById('weekSelector');
    weekSel.innerHTML = weekKeys.map(wk => {
      const obj = db.weeks[wk];
      const tag = getRelativeWeekTag(wk);
      const ph = DATA.WEEK_PHASES[obj.phase]?.shortLabel || obj.phase;
      return `<option value="${wk}">${obj.weekLabel}（${tag}｜${ph}）</option>`;
    }).join('');
    weekSel.value = ui.weekKey;

    const autoBadge = document.getElementById('weekAutoBadge');
    autoBadge.textContent = activeWeek.autoGenerated ? '⚡ 自動循環排程' : '✏️ 教練自訂微調';
    autoBadge.className = `badge ${activeWeek.autoGenerated ? 'badge-primary' : 'badge-mid'}`;

    const phaseSel = document.getElementById('globalPhaseSelect');
    phaseSel.innerHTML = Object.values(DATA.WEEK_PHASES)
      .map(ph => `<option value="${ph.id}">${ph.label}</option>`)
      .join('');
    phaseSel.value = activeWeek.phase;

    const levelSel = document.getElementById('globalLevelSelect');
    levelSel.innerHTML = Object.values(DATA.LEVELS)
      .map(lv => `<option value="${lv.id}">${lv.label}</option>`)
      .join('');
    levelSel.value = currentPlayer.level || 'varsity';

    const playerOpts = db.players
      .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}（${(DATA.LEVELS[p.level] || DATA.LEVELS.varsity).label.split('／')[0]}）</option>`)
      .join('');
    document.getElementById('coachPlayerViewSelect').innerHTML = playerOpts;
    document.getElementById('coachPlayerViewSelect').value = ui.coachViewPlayerId;
    document.getElementById('analyticsPlayerSelect').innerHTML = playerOpts;
    document.getElementById('analyticsPlayerSelect').value = ui.analyticsPlayerId;

    const dayOpts = activeWeek.days
      .map(d => `<option value="${d.dayId}">${d.dateLabel}｜${d.theme}</option>`)
      .join('');
    document.getElementById('playerDaySelect').innerHTML = dayOpts;
    document.getElementById('playerDaySelect').value = ui.dayId;

    // 歷史查詢：週次與星期下拉
    const histWeekSel = document.getElementById('histWeekFilter');
    histWeekSel.innerHTML = `<option value="all">全部已排週次（跨週查詢）</option>` +
      weekKeys.slice().reverse().map(wk => {
        const obj = db.weeks[wk];
        return `<option value="${wk}">${obj.weekLabel}（${getRelativeWeekTag(wk)}）</option>`;
      }).join('');
    histWeekSel.value = ui.histWeek;

    const histDaySel = document.getElementById('histDayFilter');
    histDaySel.innerHTML = `<option value="all">全部星期（週一～週日）</option>` +
      activeWeek.days.map(d => `<option value="${d.dayId}">${d.shortName}</option>`).join('');
    histDaySel.value = ui.histDay;

    const catOpts = ['全部', ...DATA.CATEGORIES]
      .map(c => `<option value="${c}">${c === '全部' ? '全部分類（8 大類）' : c}</option>`)
      .join('');
    document.getElementById('coachCatFilter').innerHTML = catOpts;
    document.getElementById('coachCatFilter').value = ui.coachCatFilter;
    document.getElementById('histCatFilter').innerHTML = catOpts;
    document.getElementById('histCatFilter').value = ui.histCat;

    document.getElementById('exFormCat').innerHTML = DATA.CATEGORIES
      .map(c => `<option value="${c}">${c}</option>`)
      .join('');

    document.getElementById('cloudUrlInput').value = getCloudUrl();
  }

  // --- TAB 1：球員訓練端 ---
  function renderPlayerSection() {
    const player = getPlayerById(ui.currentPlayerId);
    const activeWeek = getActiveWeek();
    const day = getDayById(ui.dayId, activeWeek);
    const stats = getPlayerDayStats(player, day, activeWeek.weekKey);
    const weekLogs = getPlayerWeekLogs(player, activeWeek.weekKey);
    const weekCheckins = getPlayerWeekCheckins(player, activeWeek.weekKey);

    document.getElementById('playerDayTitle').textContent = `${player.name} — ${day.dateLabel}｜${day.theme}`;
    document.getElementById('playerDaySub').textContent =
      `主要負荷：${day.focusMuscles}｜${DATA.WEEK_PHASES[activeWeek.phase].shortLabel}（${DATA.LEVELS[player.level].label}）`;
    document.getElementById('playerProgressLabel').textContent =
      `當日完成進度：${stats.done} / ${stats.total} 項（${stats.pct}%）｜本週完成率：${getPlayerWeeklyRate(player, activeWeek.weekKey)}%`;

    const listEl = document.getElementById('playerExerciseList');
    if (!day.exercises.length) {
      listEl.innerHTML = `<div class="card muted text-sm">這一天目前沒有安排訓練項目，請充分休息恢復！</div>`;
    } else {
      listEl.innerHTML = day.exercises.map(ex => {
        const adjSets = getAdjustedSets(ex.sets, player.level, activeWeek.phase);
        const log = weekLogs[ex.id] || {
          completed: false,
          actualReps: `${adjSets} 組 × ${ex.repsTime}`,
          actualTime: ''
        };
        return `
          <div class="exercise-check-card ${log.completed ? 'completed' : ''}">
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer;">
              <input type="checkbox" data-ex-check="${escapeHtml(ex.id)}" ${log.completed ? 'checked' : ''} style="margin-top:4px; width:18px; height:18px; accent-color:var(--primary); flex-shrink:0;" />
              <div style="flex:1;" class="stack-sm">
                <div class="flex-row" style="gap:6px;">
                  <strong style="font-size:15px; ${log.completed ? 'text-decoration:line-through; opacity:0.75;' : ''}">${escapeHtml(ex.name)}</strong>
                  <span class="badge">${escapeHtml(ex.category)}</span>
                  <span class="badge ${intensityBadgeClass(ex.intensity)}">強度：${escapeHtml(ex.intensity)}</span>
                </div>
                <div class="text-xs muted"><strong>目的：</strong>${escapeHtml(ex.purpose)}</div>
                <div class="text-xs"><strong>動作：</strong>${escapeHtml(ex.method)}</div>
                <div class="text-xs mono" style="color:var(--primary); font-weight:700;">
                  指定目標：${adjSets} 組 × ${escapeHtml(ex.repsTime)}（組間休息：${escapeHtml(ex.rest)}）
                </div>
              </div>
            </label>
            <div class="check-input-row">
              <div>
                <label class="form-label">實際完成次數</label>
                <input class="input mono" type="text" data-ex-reps="${escapeHtml(ex.id)}" value="${escapeHtml(log.actualReps)}" placeholder="例：${adjSets} 組 × ${escapeHtml(ex.repsTime)}" />
              </div>
              <div>
                <label class="form-label">實際訓練時間</label>
                <input class="input mono" type="text" data-ex-time="${escapeHtml(ex.id)}" value="${escapeHtml(log.actualTime)}" placeholder="例：6 分鐘" />
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    listEl.querySelectorAll('input[data-ex-check]').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = e.target.dataset.exCheck;
        const ex = day.exercises.find(x => x.id === id);
        const adjSets = ex ? getAdjustedSets(ex.sets, player.level, activeWeek.phase) : 3;
        const logs = getPlayerWeekLogs(player, activeWeek.weekKey);
        const prev = logs[id] || {
          actualReps: ex ? `${adjSets} 組 × ${ex.repsTime}` : '',
          actualTime: ''
        };
        logs[id] = { ...prev, completed: e.target.checked, updatedAt: formatFullDate() };
        persistState(true);
        renderAll();
      });
    });

    listEl.querySelectorAll('input[data-ex-reps], input[data-ex-time]').forEach(inp => {
      inp.addEventListener('change', () => {
        const id = inp.dataset.exReps || inp.dataset.exTime;
        const repsVal = listEl.querySelector(`input[data-ex-reps="${id}"]`).value.trim();
        const timeVal = listEl.querySelector(`input[data-ex-time="${id}"]`).value.trim();
        const logs = getPlayerWeekLogs(player, activeWeek.weekKey);
        const prev = logs[id] || { completed: false };
        logs[id] = { ...prev, actualReps: repsVal, actualTime: timeVal, updatedAt: formatFullDate() };
        persistState(true);
      });
    });

    // 當週當日身體回饋表單
    const ck = weekCheckins[ui.dayId] || {
      fatigue: 6,
      hasPain: false,
      painParts: [],
      painDesc: '',
      journal: ''
    };
    document.getElementById('fatigueSlider').value = ck.fatigue;
    document.getElementById('fatigueBadge').textContent = `${ck.fatigue} / 10`;
    document.getElementById('painToggle').checked = Boolean(ck.hasPain);
    document.getElementById('painStatusText').textContent = ck.hasPain ? '有疼痛／不適' : '無不適';
    document.getElementById('painStatusText').style.color = ck.hasPain ? 'var(--danger)' : 'var(--success)';
    document.getElementById('painDetailArea').classList.toggle('hidden', !ck.hasPain);
    document.getElementById('painDescInput').value = ck.painDesc || '';
    document.getElementById('journalTextarea').value = ck.journal || '';

    const partsBox = document.getElementById('painPartsContainer');
    partsBox.innerHTML = DATA.PAIN_PARTS.map(part => {
      const active = (ck.painParts || []).includes(part);
      return `<button type="button" class="part-chip ${active ? 'selected' : ''}" data-pain-part="${escapeHtml(part)}">${escapeHtml(part)}</button>`;
    }).join('');

    partsBox.querySelectorAll('button[data-pain-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pName = btn.dataset.painPart;
        const cks = getPlayerWeekCheckins(player, activeWeek.weekKey);
        const cur = cks[ui.dayId] || { fatigue: 6, hasPain: true, painParts: [], painDesc: '', journal: '' };
        const parts = (cur.painParts || []).includes(pName)
          ? cur.painParts.filter(x => x !== pName)
          : [...(cur.painParts || []), pName];
        cks[ui.dayId] = { ...cur, hasPain: true, painParts: parts };
        renderPlayerSection();
      });
    });
  }

  // --- TAB 2：教練管理端 ---
  function renderCoachSection() {
    const viewPlayer = getPlayerById(ui.coachViewPlayerId);
    const activeWeek = getActiveWeek();
    const day = getDayById(ui.dayId, activeWeek);
    const viewLogs = (viewPlayer.weeklyLogs && viewPlayer.weeklyLogs[activeWeek.weekKey]) || {};

    // 已排定週次快選膠囊
    const pillsBox = document.getElementById('scheduledWeeksPills');
    pillsBox.innerHTML = getSortedWeekKeys().map(wk => {
      const obj = db.weeks[wk];
      const ph = DATA.WEEK_PHASES[obj.phase]?.shortLabel || obj.phase;
      const tag = getRelativeWeekTag(wk);
      return `<button type="button" class="week-pill ${wk === ui.weekKey ? 'active' : ''}" data-jump-week="${wk}">${obj.weekLabel}｜${tag}・${ph}${obj.autoGenerated ? '' : ' ✏️'}</button>`;
    }).join('');

    pillsBox.querySelectorAll('button[data-jump-week]').forEach(btn => {
      btn.addEventListener('click', () => goToWeek(btn.dataset.jumpWeek, false));
    });

    // 7 日排程快選
    const grid = document.getElementById('coachDayGrid');
    grid.innerHTML = activeWeek.days.map(d => {
      const st = getPlayerDayStats(viewPlayer, d, activeWeek.weekKey);
      return `
        <button class="day-card ${d.dayId === ui.dayId ? 'active' : ''}" data-coach-day="${d.dayId}">
          <div class="flex-between" style="gap:4px;">
            <strong class="text-sm">${d.shortName}</strong>
            <span class="badge">${d.dayType}</span>
          </div>
          <div class="day-theme">${escapeHtml(d.theme)}</div>
          <div class="flex-between text-xs mono">
            <span class="muted">${d.exercises.length} 項</span>
            <strong style="color:${st.pct === 100 ? 'var(--success)' : 'var(--primary)'};">${st.pct}%</strong>
          </div>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('button[data-coach-day]').forEach(btn => {
      btn.addEventListener('click', () => {
        ui.dayId = btn.dataset.coachDay;
        renderAll();
      });
    });

    document.getElementById('coachTableHeading').textContent = `${day.dateLabel}｜${day.theme}（${day.exercises.length} 項）`;
    document.getElementById('coachPhaseHint').textContent =
      `${DATA.WEEK_PHASES[activeWeek.phase].label}｜${DATA.WEEK_PHASES[activeWeek.phase].note}`;

    const filtered = ui.coachCatFilter === '全部'
      ? day.exercises
      : day.exercises.filter(ex => ex.category === ui.coachCatFilter);

    const tbody = document.getElementById('coachTableBody');
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="muted" style="text-align:center; padding:24px;">目前篩選分類沒有訓練項目，請切換分類或點擊「＋ 新增訓練項目」。</td></tr>`;
    } else {
      tbody.innerHTML = filtered.map(ex => {
        const adjSets = getAdjustedSets(ex.sets, viewPlayer.level, activeWeek.phase);
        const done = Boolean(viewLogs[ex.id]?.completed);
        return `
          <tr>
            <td class="mono muted" style="white-space:nowrap;">${escapeHtml(day.dateLabel)}</td>
            <td><span class="badge">${escapeHtml(ex.category)}</span></td>
            <td><strong>${escapeHtml(ex.name)}</strong></td>
            <td class="muted">${escapeHtml(ex.purpose)}</td>
            <td>${escapeHtml(ex.method)}</td>
            <td class="mono" style="white-space:nowrap;"><strong>${adjSets} 組</strong></td>
            <td class="mono" style="white-space:nowrap;">${escapeHtml(ex.repsTime)}</td>
            <td class="mono muted" style="white-space:nowrap;">${escapeHtml(ex.rest)}</td>
            <td><span class="badge ${intensityBadgeClass(ex.intensity)}">${escapeHtml(ex.intensity)}</span></td>
            <td><span class="badge ${done ? 'badge-low' : ''}">${done ? '已完成' : '未開始'}</span></td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm" data-edit-ex="${escapeHtml(ex.id)}">修改</button>
              <button class="btn btn-danger btn-sm" data-del-ex="${escapeHtml(ex.id)}">刪除</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    tbody.querySelectorAll('button[data-edit-ex]').forEach(btn => {
      btn.addEventListener('click', () => openExerciseModal(btn.dataset.editEx));
    });
    tbody.querySelectorAll('button[data-del-ex]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!window.confirm('確定要刪除此訓練項目嗎？（僅影響本週，不影響其他週課表）')) return;
        day.exercises = day.exercises.filter(e => e.id !== btn.dataset.delEx);
        activeWeek.autoGenerated = false;
        persistState(true);
        renderAll();
        showToast('已從該週課表刪除項目。');
      });
    });

    // 全隊球員卡片（依所選週次統計）
    const pGrid = document.getElementById('coachPlayersGrid');
    pGrid.innerHTML = db.players.map(p => {
      const rate = getPlayerWeeklyRate(p, activeWeek.weekKey);
      const alerts = getPlayerPainAlerts(p, activeWeek.weekKey);
      const fbs = Object.values((p.weeklyCheckins && p.weeklyCheckins[activeWeek.weekKey]) || {});
      const avgFatigue = fbs.length ? (fbs.reduce((s, f) => s + (f.fatigue || 0), 0) / fbs.length).toFixed(1) : '-';
      return `
        <div class="card stack-sm" style="border-color:${alerts.length ? 'var(--danger)' : 'var(--border)'}; background:var(--surface-alt);">
          <div class="flex-between">
            <div>
              <strong>${escapeHtml(p.name)}</strong>
              <div class="text-xs muted">${(DATA.LEVELS[p.level] || DATA.LEVELS.varsity).label}</div>
            </div>
            <strong class="mono" style="font-size:18px; color:var(--primary);">${rate}%</strong>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${rate}%;"></div></div>
          <div class="flex-between text-xs muted">
            <span>該週平均疲勞：<strong class="mono" style="color:var(--text);">${avgFatigue}</strong></span>
            <span style="color:${alerts.length ? 'var(--danger)' : 'var(--success)'}; font-weight:700;">
              ${alerts.length ? `⚠ ${alerts.length} 筆疼痛通報` : '狀態正常'}
            </span>
          </div>
          ${alerts.length ? `<div class="text-xs" style="color:var(--danger); background:var(--surface); padding:8px; border-radius:8px; border:1px solid var(--border);">
            ${alerts.map(a => `${a.day}（${escapeHtml(a.parts.join('、'))}）：${escapeHtml(a.desc || '回報不適')}`).join('<br/>')}
          </div>` : ''}
          <div class="flex-between" style="padding-top:4px;">
            <button class="btn btn-sm" data-inspect-player="${escapeHtml(p.id)}">查看詳細紀錄</button>
            ${db.players.length > 1 ? `<button class="btn btn-danger btn-sm" data-remove-player="${escapeHtml(p.id)}">移除</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    pGrid.querySelectorAll('button[data-inspect-player]').forEach(btn => {
      btn.addEventListener('click', () => {
        ui.analyticsPlayerId = btn.dataset.inspectPlayer;
        switchTab('analytics');
        renderAll();
      });
    });

    pGrid.querySelectorAll('button[data-remove-player]').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = getPlayerById(btn.dataset.removePlayer);
        if (!window.confirm(`確定要從名單中移除球員「${target.name}」嗎？`)) return;
        db.players = db.players.filter(p => p.id !== target.id);
        ensureValidPlayerSelection();
        persistState(true);
        renderAll();
        showToast(`已移除球員 ${target.name}。`);
      });
    });
  }

  // --- TAB 3：訓練統計分析與跨週歷史 ---
  function renderAnalyticsSection() {
    const player = getPlayerById(ui.analyticsPlayerId);
    const activeWeek = getActiveWeek();
    const weekEx = getWeekExercises(activeWeek);
    const weekLogs = (player.weeklyLogs && player.weeklyLogs[activeWeek.weekKey]) || {};
    const pRate = getPlayerWeeklyRate(player, activeWeek.weekKey);
    const teamAvg = Math.round(db.players.reduce((s, p) => s + getPlayerWeeklyRate(p, activeWeek.weekKey), 0) / Math.max(1, db.players.length));
    const pDoneWeek = weekEx.filter(ex => weekLogs[ex.id]?.completed).length;
    const totalAllWeeks = getPlayerTotalCompletedAllWeeks(player);
    const teamPainCount = db.players.reduce((s, p) => s + getPlayerPainAlerts(p, activeWeek.weekKey).length, 0);

    document.getElementById('analyticsKpiGrid').innerHTML = `
      <div class="card">
        <div class="text-xs muted">${escapeHtml(player.name)}（${getRelativeWeekTag(activeWeek.weekKey)}）完成率</div>
        <div class="mono" style="font-size:26px; font-weight:800; color:var(--primary); margin:4px 0;">${pRate}%</div>
        <div class="text-xs muted">該週完成 ${pDoneWeek} / ${weekEx.length} 項</div>
      </div>
      <div class="card">
        <div class="text-xs muted">全隊該週平均完成率</div>
        <div class="mono" style="font-size:26px; font-weight:800; margin:4px 0;">${teamAvg}%</div>
        <div class="text-xs muted">${activeWeek.weekLabel}（共 ${db.players.length} 人）</div>
      </div>
      <div class="card">
        <div class="text-xs muted">${escapeHtml(player.name)} 跨週累計完成</div>
        <div class="mono" style="font-size:26px; font-weight:800; margin:4px 0;">${totalAllWeeks} 項</div>
        <div class="text-xs muted">已排定週次共 ${getSortedWeekKeys().length} 週</div>
      </div>
      <div class="card">
        <div class="text-xs muted">全隊該週疼痛通報</div>
        <div class="mono" style="font-size:26px; font-weight:800; color:${teamPainCount ? 'var(--danger)' : 'var(--success)'}; margin:4px 0;">${teamPainCount} 筆</div>
        <div class="text-xs muted">每週獨立追蹤，方便長期防護</div>
      </div>
    `;

    document.getElementById('trendTitle').textContent = `${player.name} — 體能進步趨勢`;

    // 跨週個人歷史查詢
    const targetWeekKeys = ui.histWeek === 'all' ? getSortedWeekKeys().slice().reverse() : [ui.histWeek];
    const rows = [];
    targetWeekKeys.forEach(wk => {
      const wkObj = db.weeks[wk];
      if (!wkObj) return;
      const logs = (player.weeklyLogs && player.weeklyLogs[wk]) || {};
      const cks = (player.weeklyCheckins && player.weeklyCheckins[wk]) || {};
      getWeekExercises(wkObj).forEach(ex => {
        if (ui.histDay !== 'all' && ex.dayId !== ui.histDay) return;
        if (ui.histCat !== '全部' && ex.category !== ui.histCat) return;
        const log = logs[ex.id] || { completed: false, actualReps: '', actualTime: '' };
        if (ui.histStatus === 'done' && !log.completed) return;
        if (ui.histStatus === 'pending' && log.completed) return;
        rows.push({ ex, log, ck: cks[ex.dayId] });
      });
    });

    const histBody = document.getElementById('historyTableBody');
    if (!rows.length) {
      histBody.innerHTML = `<tr><td colspan="8" class="muted" style="text-align:center; padding:24px;">查無符合條件的訓練歷史紀錄。</td></tr>`;
    } else {
      histBody.innerHTML = rows.map(({ ex, log, ck }) => {
        const adjSets = getAdjustedSets(ex.sets, player.level, ex.weekPhase);
        const note = ck
          ? `疲勞 ${ck.fatigue}/10${ck.hasPain ? `｜⚠ ${ck.painParts.join('、')}` : '｜無不適'}`
          : '尚未填寫回饋';
        return `
          <tr>
            <td class="mono muted" style="white-space:nowrap;">${escapeHtml(ex.dateLabel)}</td>
            <td><span class="badge">${escapeHtml(ex.category)}</span></td>
            <td><strong>${escapeHtml(ex.name)}</strong></td>
            <td class="mono muted" style="white-space:nowrap;">${adjSets} 組 × ${escapeHtml(ex.repsTime)}</td>
            <td class="mono">${log.completed ? `${escapeHtml(log.actualReps || '依課表')} ${log.actualTime ? `（${escapeHtml(log.actualTime)}）` : ''}` : '-'}</td>
            <td><span class="badge ${intensityBadgeClass(ex.intensity)}">${escapeHtml(ex.intensity)}</span></td>
            <td><span class="badge ${log.completed ? 'badge-low' : ''}">${log.completed ? '已完成' : '未開始'}</span></td>
            <td style="color:${ck?.hasPain ? 'var(--danger)' : 'var(--text-muted)'};">${escapeHtml(note)}</td>
          </tr>
        `;
      }).join('');
    }

    drawCharts();
  }

  // =========================================================================
  // 6. Canvas 圖表（深淺主題自適應）
  // =========================================================================
  function getCanvasColors() {
    const cs = getComputedStyle(document.documentElement);
    const val = (k, fb) => (cs.getPropertyValue(k) || '').trim() || fb;
    return {
      text: val('--text', '#0f172a'),
      muted: val('--text-muted', '#475569'),
      border: val('--border', '#e2e8f0'),
      primary: val('--primary', '#0f766e'),
      accent: val('--accent', '#0284c7'),
      success: val('--success', '#15803d')
    };
  }

  function setupCanvas(canvas) {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(260, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawCharts() {
    if (ui.activeTab !== 'analytics') return;
    drawTeamBarChart();
    drawTrendLineChart();
  }

  function drawTeamBarChart() {
    const canvas = document.getElementById('teamBarCanvas');
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const c = getCanvasColors();
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 24, right: 18, bottom: 36, left: 42 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [0, 25, 50, 75, 100].forEach(v => {
      const y = pad.top + plotH * (1 - v / 100);
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(`${v}%`, pad.left - 6, y);
    });

    const y85 = pad.top + plotH * (1 - 0.85);
    ctx.save();
    ctx.strokeStyle = c.success;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y85);
    ctx.lineTo(w - pad.right, y85);
    ctx.stroke();
    ctx.restore();

    const list = db.players.slice(0, 10);
    const slotW = plotW / Math.max(1, list.length);
    const barW = Math.min(48, slotW * 0.52);

    list.forEach((p, idx) => {
      const rate = getPlayerWeeklyRate(p, ui.weekKey);
      const cx = pad.left + slotW * idx + slotW / 2;
      const barH = (rate / 100) * plotH;
      const x = cx - barW / 2;
      const y = pad.top + plotH - barH;

      ctx.fillStyle = p.id === ui.analyticsPlayerId ? c.primary : c.accent;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, Math.max(2, barH), [6, 6, 0, 0]);
      ctx.fill();

      ctx.fillStyle = c.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${rate}%`, cx, y - 4);

      ctx.fillStyle = p.id === ui.analyticsPlayerId ? c.text : c.muted;
      ctx.textBaseline = 'top';
      ctx.font = p.id === ui.analyticsPlayerId ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.fillText(p.name.slice(0, 5), cx, pad.top + plotH + 10);
    });
  }

  function drawTrendLineChart() {
    const canvas = document.getElementById('trendLineCanvas');
    if (!canvas) return;
    const { ctx, w, h } = setupCanvas(canvas);
    const c = getCanvasColors();
    ctx.clearRect(0, 0, w, h);

    const player = getPlayerById(ui.analyticsPlayerId);
    const tests = player.fitnessTests || [];
    const metricInfo = DATA.FITNESS_METRICS[ui.trendMetric];

    if (!tests.length) {
      ctx.fillStyle = c.muted;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('尚無體能檢測資料，請點擊右上角「＋ 登錄體能檢測」新增紀錄', w / 2, h / 2);
      return;
    }

    const vals = tests.map(t => Number(t[ui.trendMetric]) || 0);
    const labels = tests.map(t => t.date);

    const pad = { top: 26, right: 24, bottom: 36, left: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const minRaw = Math.min(...vals);
    const maxRaw = Math.max(...vals);
    const span = Math.max(1, maxRaw - minRaw);
    const minV = minRaw - span * 0.25;
    const maxV = maxRaw + span * 0.25;

    ctx.font = '12px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = minV + ((maxV - minV) * i) / 4;
      const y = pad.top + plotH * (1 - i / 4);
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = c.muted;
      ctx.fillText(ui.trendMetric === 'sixPointSec' ? v.toFixed(1) : Math.round(v), pad.left - 8, y);
    }

    const pts = vals.map((v, i) => ({
      x: vals.length === 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (vals.length - 1),
      y: pad.top + plotH * (1 - (v - minV) / (maxV - minV)),
      v
    }));

    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pad.top + plotH);
      pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
      ctx.lineTo(pts[pts.length - 1].x, pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = c.primary;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = c.primary;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
    }

    pts.forEach((pt, i) => {
      ctx.fillStyle = c.primary;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = c.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${pt.v}${metricInfo.unit}`, pt.x, pt.y - 8);

      ctx.fillStyle = c.muted;
      ctx.textBaseline = 'top';
      ctx.font = '12px sans-serif';
      ctx.fillText(labels[i], pt.x, pad.top + plotH + 10);
    });
  }

  // =========================================================================
  // 7. Modal 與匯出功能
  // =========================================================================
  function openExerciseModal(editId = null) {
    const day = getDayById(ui.dayId, getActiveWeek());
    if (editId) {
      const ex = day.exercises.find(x => x.id === editId);
      if (!ex) return;
      document.getElementById('exerciseModalTitle').textContent = `修改訓練項目（${day.dateLabel}）`;
      document.getElementById('editExerciseId').value = ex.id;
      document.getElementById('exFormCat').value = ex.category;
      document.getElementById('exFormIntensity').value = ex.intensity;
      document.getElementById('exFormName').value = ex.name;
      document.getElementById('exFormPurpose').value = ex.purpose;
      document.getElementById('exFormMethod').value = ex.method;
      document.getElementById('exFormSets').value = ex.sets;
      document.getElementById('exFormReps').value = ex.repsTime;
      document.getElementById('exFormRest').value = ex.rest;
    } else {
      document.getElementById('exerciseModalTitle').textContent = `新增訓練項目至 ${day.dateLabel}`;
      document.getElementById('exerciseForm').reset();
      document.getElementById('editExerciseId').value = '';
      document.getElementById('exFormSets').value = 3;
    }
    document.getElementById('exerciseModal').classList.remove('hidden');
  }

  function closeExerciseModal() {
    document.getElementById('exerciseModal').classList.add('hidden');
  }

  function openFitnessModal() {
    const player = getPlayerById(ui.analyticsPlayerId);
    document.getElementById('fitnessModalTitle').textContent = `登錄體能檢測數據 — ${player.name}`;
    document.getElementById('fitnessForm').reset();
    document.getElementById('ftDate').value = formatShortDate();
    document.getElementById('fitnessModal').classList.remove('hidden');
  }

  function closeFitnessModal() {
    document.getElementById('fitnessModal').classList.add('hidden');
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const player = getPlayerById(ui.analyticsPlayerId || ui.currentPlayerId);
    const activeWeek = getActiveWeek();
    const logs = (player.weeklyLogs && player.weeklyLogs[activeWeek.weekKey]) || {};
    const headers = ['週次', '週期階段', '訓練日期及星期', '訓練分類', '訓練名稱', '訓練目的', '動作說明', '組數', '每組次數或時間', '組間休息時間', '訓練強度', '完成狀態', '實際完成次數', '實際訓練時間'];
    const lines = [headers.join(',')];
    getWeekExercises(activeWeek).forEach(ex => {
      const log = logs[ex.id] || {};
      const cols = [
        activeWeek.weekLabel,
        DATA.WEEK_PHASES[activeWeek.phase]?.shortLabel || activeWeek.phase,
        ex.dateLabel,
        ex.category,
        ex.name,
        ex.purpose,
        ex.method,
        `${getAdjustedSets(ex.sets, player.level, activeWeek.phase)} 組`,
        ex.repsTime,
        ex.rest,
        ex.intensity,
        log.completed ? '已完成' : '未開始',
        log.actualReps || '',
        log.actualTime || ''
      ].map(v => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(cols.join(','));
    });
    downloadFile(`羽球體適能課表_${player.name}_${activeWeek.weekKey}.csv`, '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8;');
    showToast(`已下載 ${player.name}（${activeWeek.weekLabel}）的課表 CSV！`);
  }

  function exportJson() {
    downloadFile(`羽球體適能多週備份_${formatShortDate().replace('/', '-')}.json`, JSON.stringify(db, null, 2), 'application/json');
    showToast('已下載全隊多週課表與訓練紀錄 JSON 備份！');
  }

  // =========================================================================
  // 8. 事件綁定與初始化
  // =========================================================================
  function renderAll() {
    ensureValidPlayerSelection();
    syncGlobalControls();
    renderPlayerSection();
    renderCoachSection();
    renderAnalyticsSection();
  }

  function bindEvents() {
    // 免登入入口
    document.getElementById('nameEntryForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('entryNameInput').value.trim();
      if (!name) return;
      const level = document.getElementById('entryLevelSelect').value;
      const player = findOrCreatePlayerByName(name, level);
      enterAppAsPlayer(player.id, 'player');
      showToast(`歡迎，${player.name}！已自動為您載入本週課表。`);
    });

    document.getElementById('enterAsCoachBtn').addEventListener('click', () => {
      ensureValidPlayerSelection();
      enterAppAsPlayer(db.players[0].id, 'coach');
    });

    document.getElementById('switchUserBtn').addEventListener('click', openEntryScreen);

    // 頁籤切換
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 多週切換控制列
    document.getElementById('prevWeekBtn').addEventListener('click', () => {
      goToWeek(DATA.addWeeksToIso(ui.weekKey, -1), true);
    });
    document.getElementById('nextWeekBtn').addEventListener('click', () => {
      goToWeek(DATA.addWeeksToIso(ui.weekKey, 1), true);
    });
    document.getElementById('todayWeekBtn').addEventListener('click', () => {
      ui.dayId = getTodayDayId();
      goToWeek(TODAY_WEEK_KEY, false);
      showToast('已切回本週課表！');
    });
    document.getElementById('weekSelector').addEventListener('change', (e) => {
      goToWeek(e.target.value, false);
    });

    document.getElementById('globalPhaseSelect').addEventListener('change', (e) => {
      const wk = getActiveWeek();
      wk.phase = e.target.value;
      wk.autoGenerated = false;
      persistState(true);
      renderAll();
      showToast(`已將 ${wk.weekLabel} 調整為「${DATA.WEEK_PHASES[wk.phase].shortLabel}」。`);
    });

    document.getElementById('globalLevelSelect').addEventListener('change', (e) => {
      const p = getPlayerById(ui.currentPlayerId);
      p.level = e.target.value;
      persistState(true);
      renderAll();
    });

    // 教練批次排週工具列
    document.getElementById('generateNext4WeeksBtn').addEventListener('click', () => {
      const anchor = db.cycleAnchorWeek || TODAY_WEEK_KEY;
      const anchorPhase = db.cycleAnchorPhase || 'w2';
      let created = 0;
      for (let i = 1; i <= 4; i++) {
        const targetKey = DATA.addWeeksToIso(ui.weekKey, i);
        if (!db.weeks[targetKey]) {
          db.weeks[targetKey] = DATA.buildWeekObject(targetKey, DATA.computeAutoPhase(anchor, targetKey, anchorPhase), null, true);
          created += 1;
        }
      }
      persistState(true);
      renderAll();
      showToast(created > 0
        ? `已自動預排往後 ${created} 週課表（自動依 W1→W2→W3→W4 循環）！`
        : '未來 4 週課表皆已排定，您可直接點擊上方週次標籤切換檢視！');
    });

    document.getElementById('copyWeekToNextBtn').addEventListener('click', () => {
      const curWeek = getActiveWeek();
      const nextKey = DATA.addWeeksToIso(curWeek.weekKey, 1);
      const curIdx = Math.max(0, DATA.PHASE_ORDER.indexOf(curWeek.phase));
      const nextPhase = DATA.PHASE_ORDER[(curIdx + 1) % 4];
      db.weeks[nextKey] = DATA.buildWeekObject(nextKey, nextPhase, curWeek.days, false);
      persistState(true);
      goToWeek(nextKey, false);
      showToast(`已複製本週微調課表至下週（${db.weeks[nextKey].weekLabel}），並自動推進為 ${DATA.WEEK_PHASES[nextPhase].shortLabel}！`);
    });

    document.getElementById('resetCurrentWeekBtn').addEventListener('click', () => {
      const wk = getActiveWeek();
      if (!window.confirm(`確定要將 ${wk.weekLabel} 重設回系統自動循環課表嗎？`)) return;
      const autoPhase = DATA.computeAutoPhase(db.cycleAnchorWeek || TODAY_WEEK_KEY, wk.weekKey, db.cycleAnchorPhase || 'w2');
      db.weeks[wk.weekKey] = DATA.buildWeekObject(wk.weekKey, autoPhase, null, true);
      persistState(true);
      renderAll();
      showToast('已重設為系統自動排程課表。');
    });

    document.getElementById('themeToggleBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    document.getElementById('manualSyncBtn').addEventListener('click', () => pullFromCloud(false));

    // 球員端互動
    document.getElementById('playerDaySelect').addEventListener('change', (e) => {
      ui.dayId = e.target.value;
      renderAll();
    });

    document.getElementById('playerCheckAllBtn').addEventListener('click', () => {
      const player = getPlayerById(ui.currentPlayerId);
      const activeWeek = getActiveWeek();
      const day = getDayById(ui.dayId, activeWeek);
      const logs = getPlayerWeekLogs(player, activeWeek.weekKey);
      day.exercises.forEach(ex => {
        const prev = logs[ex.id] || {
          actualReps: `${getAdjustedSets(ex.sets, player.level, activeWeek.phase)} 組 × ${ex.repsTime}`,
          actualTime: '依課表完成'
        };
        logs[ex.id] = { ...prev, completed: true, updatedAt: formatFullDate() };
      });
      persistState(true);
      renderAll();
      showToast('已將當日所有訓練標記為完成！');
    });

    document.getElementById('fatigueSlider').addEventListener('input', (e) => {
      document.getElementById('fatigueBadge').textContent = `${e.target.value} / 10`;
    });

    document.getElementById('painToggle').addEventListener('change', (e) => {
      const hasPain = e.target.checked;
      document.getElementById('painDetailArea').classList.toggle('hidden', !hasPain);
      document.getElementById('painStatusText').textContent = hasPain ? '有疼痛／不適' : '無不適';
      document.getElementById('painStatusText').style.color = hasPain ? 'var(--danger)' : 'var(--success)';
    });

    document.getElementById('saveCheckinBtn').addEventListener('click', () => {
      const player = getPlayerById(ui.currentPlayerId);
      const cks = getPlayerWeekCheckins(player, ui.weekKey);
      const prev = cks[ui.dayId] || { painParts: [] };
      const hasPain = document.getElementById('painToggle').checked;
      cks[ui.dayId] = {
        fatigue: parseInt(document.getElementById('fatigueSlider').value, 10) || 6,
        hasPain,
        painParts: hasPain ? (prev.painParts?.length ? prev.painParts : ['一般痠痛']) : [],
        painDesc: hasPain ? document.getElementById('painDescInput').value.trim() : '',
        journal: document.getElementById('journalTextarea').value.trim(),
        updatedAt: formatFullDate()
      };
      persistState(true);
      renderAll();
      showToast('已儲存今日訓練回饋與身體狀況！');
    });

    // 教練端互動
    document.getElementById('coachPlayerViewSelect').addEventListener('change', (e) => {
      ui.coachViewPlayerId = e.target.value;
      renderCoachSection();
    });

    document.getElementById('coachCatFilter').addEventListener('change', (e) => {
      ui.coachCatFilter = e.target.value;
      renderCoachSection();
    });

    document.getElementById('addExerciseBtn').addEventListener('click', () => openExerciseModal(null));
    document.getElementById('closeExerciseModalBtn').addEventListener('click', closeExerciseModal);
    document.getElementById('cancelExerciseModalBtn').addEventListener('click', closeExerciseModal);

    document.getElementById('exerciseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const activeWeek = getActiveWeek();
      const day = getDayById(ui.dayId, activeWeek);
      const editId = document.getElementById('editExerciseId').value;
      const payload = {
        id: editId || `e-${day.dayId}-${Date.now()}`,
        category: document.getElementById('exFormCat').value,
        intensity: document.getElementById('exFormIntensity').value,
        name: document.getElementById('exFormName').value.trim(),
        purpose: document.getElementById('exFormPurpose').value.trim(),
        method: document.getElementById('exFormMethod').value.trim(),
        sets: parseInt(document.getElementById('exFormSets').value, 10) || 3,
        repsTime: document.getElementById('exFormReps').value.trim(),
        rest: document.getElementById('exFormRest').value.trim()
      };
      if (editId) {
        const idx = day.exercises.findIndex(x => x.id === editId);
        if (idx !== -1) day.exercises[idx] = payload;
      } else {
        day.exercises.push(payload);
      }
      activeWeek.autoGenerated = false;
      persistState(true);
      closeExerciseModal();
      renderAll();
      showToast(editId ? '已更新該週訓練項目！' : '已新增訓練項目至該週課表！');
    });

    document.getElementById('coachAddPlayerForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('coachNewPlayerName');
      const name = nameInput.value.trim();
      if (!name) return;
      const level = document.getElementById('coachNewPlayerLevel').value;
      const p = findOrCreatePlayerByName(name, level);
      nameInput.value = '';
      renderAll();
      showToast(`已將球員「${p.name}」加入球隊名單！`);
    });

    // 統計分析與歷史篩選
    document.getElementById('analyticsPlayerSelect').addEventListener('change', (e) => {
      ui.analyticsPlayerId = e.target.value;
      renderAnalyticsSection();
    });
    document.getElementById('trendMetricSelect').addEventListener('change', (e) => {
      ui.trendMetric = e.target.value;
      drawTrendLineChart();
    });
    document.getElementById('histWeekFilter').addEventListener('change', (e) => {
      ui.histWeek = e.target.value;
      renderAnalyticsSection();
    });
    document.getElementById('histDayFilter').addEventListener('change', (e) => {
      ui.histDay = e.target.value;
      renderAnalyticsSection();
    });
    document.getElementById('histCatFilter').addEventListener('change', (e) => {
      ui.histCat = e.target.value;
      renderAnalyticsSection();
    });
    document.getElementById('histStatusFilter').addEventListener('change', (e) => {
      ui.histStatus = e.target.value;
      renderAnalyticsSection();
    });

    document.getElementById('openFitnessTestBtn').addEventListener('click', openFitnessModal);
    document.getElementById('closeFitnessModalBtn').addEventListener('click', closeFitnessModal);
    document.getElementById('cancelFitnessModalBtn').addEventListener('click', closeFitnessModal);

    document.getElementById('fitnessForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const player = getPlayerById(ui.analyticsPlayerId);
      player.fitnessTests = player.fitnessTests || [];
      player.fitnessTests.push({
        date: document.getElementById('ftDate').value.trim(),
        broadJump: Number(document.getElementById('ftBroad').value),
        verticalJump: Number(document.getElementById('ftVertical').value),
        sixPointSec: Number(document.getElementById('ftSixPoint').value),
        plankSec: Number(document.getElementById('ftPlank').value)
      });
      persistState(true);
      closeFitnessModal();
      renderAnalyticsSection();
      showToast(`已新增 ${player.name} 的最新體能檢測紀錄！`);
    });

    // 雲端同步與匯出
    document.getElementById('saveCloudUrlBtn').addEventListener('click', async () => {
      const url = document.getElementById('cloudUrlInput').value.trim();
      localStorage.setItem(CLOUD_URL_KEY, url);
      if (!url) {
        setSyncBadge('本機儲存模式', 'badge-primary');
        document.getElementById('cloudDiagMsg').textContent = '已切換回零設定本機儲存模式。';
        showToast('已切換回本機儲存模式。');
        return;
      }
      document.getElementById('cloudDiagMsg').textContent = '正在測試連線至 Google Apps Script...';
      const ok = await pullFromCloud(false);
      document.getElementById('cloudDiagMsg').textContent = ok
        ? '✅ 連線成功！之後多週排課與球員打卡都會自動同步至您的 Google 試算表。'
        : '⚠ 若是首次連結空白試算表，請點「上傳本機資料至雲端」完成初始化。';
    });

    document.getElementById('pullCloudBtn').addEventListener('click', () => pullFromCloud(false));
    document.getElementById('pushCloudBtn').addEventListener('click', () => pushToCloud(false));
    document.getElementById('downloadCsvBtn').addEventListener('click', exportCsv);
    document.getElementById('downloadJsonBtn').addEventListener('click', exportJson);

    document.getElementById('importJsonInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (parsed.version === 2 && parsed.weeks && Array.isArray(parsed.players)) {
            db = parsed;
          } else if (Array.isArray(parsed.weeklyPlan) && Array.isArray(parsed.players)) {
            db = migrateV1ToV2(parsed);
          } else {
            throw new Error('格式不符合備份結構');
          }
          ensureWeekExists(TODAY_WEEK_KEY, false);
          ensureValidPlayerSelection();
          persistState(true);
          renderAll();
          showToast('已成功匯入並還原全隊多週備份資料！');
        } catch (err) {
          showToast(`匯入失敗：${err.message}`);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('resetDemoBtn').addEventListener('click', () => {
      if (!window.confirm('確定要重設為預設羽球示範課表與資料嗎？（建議先下載 JSON 備份）')) return;
      db = createFreshState();
      ui.weekKey = TODAY_WEEK_KEY;
      ensureValidPlayerSelection();
      persistState(true);
      renderAll();
      showToast('已重設為預設多週羽球課表。');
    });

    window.addEventListener('resize', () => {
      if (ui.activeTab === 'analytics') drawCharts();
    });
  }

  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'light');
    ensureValidPlayerSelection();
    bindEvents();
    renderQuickPlayerChips();

    if (getCloudUrl()) {
      setSyncBadge('連線雲端中...', 'badge-mid');
      await pullFromCloud(true);
    } else {
      setSyncBadge('本機儲存模式', 'badge-primary');
    }

    try {
      const last = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      if (last && last.playerId && db.players.some(p => p.id === last.playerId)) {
        enterAppAsPlayer(last.playerId, last.isCoach ? 'coach' : 'player');
        return;
      }
    } catch (_) {
      // 忽略異常並開啟名字入口頁
    }
    openEntryScreen();
  }

  init();
})();
