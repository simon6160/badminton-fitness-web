/**
 * 羽球員體適能訓練管理網站 — 免費 Google 試算表雲端同步腳本（支援 v2 多週獨立歸檔）
 * ============================================================================
 * 使用方式：
 * 1. 開啟一張新的 Google 試算表 → 上方選單「擴充功能」→「Apps Script」。
 * 2. 將此檔案全部內容貼上並儲存。
 * 3. 點選右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」。
 *    - 執行身分：我
 *    - 誰可以存取：所有人
 * 4. 複製產生的 Web App 網址，貼入網站 config.js 的 CLOUD_API_URL（或網頁內「雲端同步」分頁）。
 */

const STATE_SHEET_NAME = '_RAW_STATE';

function doGet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(STATE_SHEET_NAME);
    if (!sheet) return jsonResponse({ ok: true, data: null });
    const raw = sheet.getRange('A1').getValue();
    if (!raw) return jsonResponse({ ok: true, data: null });
    return jsonResponse({ ok: true, data: JSON.parse(raw) });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.action !== 'saveAll' || !body.data) {
      return jsonResponse({ ok: false, error: '無效的請求格式' });
    }

    const data = body.data;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const stateSheet = getOrCreateSheet(ss, STATE_SHEET_NAME);
    stateSheet.getRange('A1').setValue(JSON.stringify(data));
    stateSheet.getRange('A2').setValue('最後同步時間：' + new Date().toLocaleString('zh-TW'));

    writeReadableSheets(ss, data);
    return jsonResponse({ ok: true, updatedAt: new Date().toISOString() });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function replaceSheetRows(ss, sheetName, headers, rows) {
  const sheet = getOrCreateSheet(ss, sheetName);
  sheet.clearContents();
  const allRows = [headers].concat(rows);
  sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);
  sheet.setFrozenRows(1);
}

function writeReadableSheets(ss, data) {
  const weeksMap = data.weeks || {};
  const weekKeys = Object.keys(weeksMap).sort();
  const players = data.players || [];

  // 分頁 1：多週課表總覽
  const planRows = [];
  weekKeys.forEach(function (wk) {
    const weekObj = weeksMap[wk];
    (weekObj.days || []).forEach(function (d) {
      (d.exercises || []).forEach(function (ex) {
        planRows.push([
          weekObj.weekLabel,
          weekObj.phase,
          d.dateLabel,
          d.theme,
          ex.category,
          ex.name,
          ex.purpose,
          ex.method,
          ex.sets,
          ex.repsTime,
          ex.rest,
          ex.intensity
        ]);
      });
    });
  });
  replaceSheetRows(
    ss,
    '每週課表',
    ['週次區間', '週期階段', '日期及星期', '當日主題', '訓練分類', '訓練名稱', '訓練目的', '動作說明', '基準組數', '每組次數或時間', '組間休息', '強度'],
    planRows
  );

  // 分頁 2：各週球員完成率總表
  const summaryRows = [];
  weekKeys.forEach(function (wk) {
    const weekObj = weeksMap[wk];
    const exList = [];
    (weekObj.days || []).forEach(function (d) {
      (d.exercises || []).forEach(function (ex) { exList.push(ex); });
    });
    players.forEach(function (p) {
      const logs = (p.weeklyLogs && p.weeklyLogs[wk]) || {};
      const doneCount = exList.filter(function (ex) {
        return logs[ex.id] && logs[ex.id].completed;
      }).length;
      const rate = exList.length ? Math.round((doneCount / exList.length) * 100) + '%' : '0%';
      const cks = Object.values((p.weeklyCheckins && p.weeklyCheckins[wk]) || {});
      const painCount = cks.filter(function (c) { return c && c.hasPain; }).length;
      summaryRows.push([weekObj.weekLabel, weekObj.phase, p.name, p.level, doneCount, exList.length, rate, painCount]);
    });
  });
  replaceSheetRows(
    ss,
    '球員完成率總表',
    ['週次區間', '週期階段', '球員姓名', '分級', '已完成項數', '該週總項數', '週完成率', '疼痛通報次數'],
    summaryRows
  );

  // 分頁 3：球員打卡明細（跨週累計）
  const logRows = [];
  weekKeys.forEach(function (wk) {
    const weekObj = weeksMap[wk];
    players.forEach(function (p) {
      const logs = (p.weeklyLogs && p.weeklyLogs[wk]) || {};
      (weekObj.days || []).forEach(function (d) {
        (d.exercises || []).forEach(function (ex) {
          const rec = logs[ex.id];
          if (rec && rec.completed) {
            logRows.push([
              weekObj.weekLabel,
              p.name,
              d.dateLabel,
              ex.category,
              ex.name,
              '已完成',
              rec.actualReps || '',
              rec.actualTime || '',
              rec.updatedAt || ''
            ]);
          }
        });
      });
    });
  });
  replaceSheetRows(
    ss,
    '球員打卡明細',
    ['週次區間', '球員姓名', '日期及星期', '訓練分類', '訓練名稱', '完成狀態', '實際完成次數', '實際訓練時間', '更新日期'],
    logRows
  );

  // 分頁 4：身體狀況與疼痛回報（跨週累計）
  const checkinRows = [];
  weekKeys.forEach(function (wk) {
    const weekObj = weeksMap[wk];
    players.forEach(function (p) {
      const cks = (p.weeklyCheckins && p.weeklyCheckins[wk]) || {};
      Object.keys(cks).forEach(function (dayId) {
        const ck = cks[dayId];
        if (!ck) return;
        checkinRows.push([
          weekObj.weekLabel,
          p.name,
          dayId,
          ck.fatigue || '',
          ck.hasPain ? '有不適' : '正常',
          (ck.painParts || []).join('、'),
          ck.painDesc || '',
          ck.journal || '',
          ck.updatedAt || ''
        ]);
      });
    });
  });
  replaceSheetRows(
    ss,
    '身體狀況與疼痛回報',
    ['週次區間', '球員姓名', '星期代號', '疲勞度(1-10)', '是否疼痛', '不適部位', '疼痛描述', '訓練心得', '回報日期'],
    checkinRows
  );
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
