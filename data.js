/**
 * 羽球專項體適能核心課表與多週自動排程引擎
 * 完整涵蓋 8 大分類、33 項羽球專項訓練、4 週自動漸進循環與分級參數
 */
window.BADMINTON_DATA = (function () {
  const CATEGORIES = [
    '核心訓練',
    '跳繩訓練',
    '下肢肌力訓練',
    '爆發力訓練',
    '羽球專項步伐訓練',
    '敏捷及反應訓練',
    '心肺耐力訓練',
    '運動防護及恢復'
  ];

  const PAIN_PARTS = [
    '右肩／旋轉肌袖',
    '手肘／手腕',
    '下背／腰部',
    '髖部／鼠蹊',
    '膝關節前側',
    '小腿／阿基里斯腱',
    '腳踝'
  ];

  const PHASE_ORDER = ['w1', 'w2', 'w3', 'w4'];

  const WEEK_PHASES = {
    w1: {
      id: 'w1',
      label: '第 1 週：動作適應期（85% 量）',
      shortLabel: 'W1 適應期',
      setDelta: -1,
      note: '建立深蹲、跨步、落地吸震與啟動步正確動作控制，組數減 1 組（最低 2 組）。'
    },
    w2: {
      id: 'w2',
      label: '第 2 週：基礎累積期（100% 標準）',
      shortLabel: 'W2 基礎期',
      setDelta: 0,
      note: '依標準週課表完整執行，穩定提升下肢肌力、跳繩節奏與心肺基底。'
    },
    w3: {
      id: 'w3',
      label: '第 3 週：強度提升期（115% 強化）',
      shortLabel: 'W3 強化期',
      setDelta: 1,
      note: '主訓練組數增加 1 組，模擬高強度比賽節奏並強化無氧恢復。'
    },
    w4: {
      id: 'w4',
      label: '第 4 週：賽前減量檢測期（75% 調整）',
      shortLabel: 'W4 檢測期',
      setDelta: -1,
      note: '降低訓練總量以消除累積疲勞、保留爆發速度，並記錄最新體能檢測數據。'
    }
  };

  const LEVELS = {
    youth: {
      id: 'youth',
      label: '青少年／基礎組',
      setDelta: -1,
      tip: '徒手與動作標準優先，單腳跳躍與蹲跳降低落地衝擊。'
    },
    varsity: {
      id: 'varsity',
      label: '校隊／進階組',
      setDelta: 0,
      tip: '標準羽球專項強度，兼顧肌力、步伐轉化與運動防護。'
    },
    elite: {
      id: 'elite',
      label: '公開／競技組',
      setDelta: 1,
      tip: '下肢肌力可搭配啞鈴或負重背心，步伐與反應追求極速回中。'
    }
  };

  const FITNESS_METRICS = {
    broadJump: { label: '立定跳遠', unit: 'cm', better: 'higher' },
    verticalJump: { label: '原地垂直跳', unit: 'cm', better: 'higher' },
    sixPointSec: { label: '六點移動步伐（2輪）', unit: '秒', better: 'lower' },
    plankSec: { label: '核心棒式支撐', unit: '秒', better: 'higher' }
  };

  // =========================================================================
  // 日期與週次計算工具（以每週一 YYYY-MM-DD 為唯一 weekKey）
  // =========================================================================
  function toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function parseIsoDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function getMondayIso(dateObj = new Date()) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const day = d.getDay(); // 0=日, 1=一...
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toIsoDate(d);
  }

  function addWeeksToIso(mondayIso, offsetWeeks) {
    const d = parseIsoDate(mondayIso);
    d.setDate(d.getDate() + offsetWeeks * 7);
    return toIsoDate(d);
  }

  function diffWeeksBetween(anchorIso, targetIso) {
    const a = parseIsoDate(anchorIso);
    const b = parseIsoDate(targetIso);
    return Math.round((b.getTime() - a.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }

  // 依據基準週自動推算 4 週漸進循環（W1 → W2 → W3 → W4 → W1 ...）
  function computeAutoPhase(anchorIso, targetWeekIso, anchorPhase = 'w2') {
    const startIdx = Math.max(0, PHASE_ORDER.indexOf(anchorPhase));
    const delta = diffWeeksBetween(anchorIso, targetWeekIso);
    const idx = ((startIdx + delta) % 4 + 4) % 4;
    return PHASE_ORDER[idx];
  }

  function formatWeekRangeLabel(mondayIso) {
    const mon = parseIsoDate(mondayIso);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (d, withYear) => {
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return withYear ? `${d.getFullYear()}/${m}/${day}` : `${m}/${day}`;
    };
    return `${fmt(mon, true)} ～ ${fmt(sun, false)}`;
  }

  function getWeekDayLabels(mondayIso) {
    const mon = parseIsoDate(mondayIso);
    const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
    return weekdays.map((wk, idx) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + idx);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${dd}（${wk}）`;
    });
  }

  // 標準 7 日羽球專項模板（無固定日期，產生任意週次時自動帶入當週日期）
  function getMasterWeekTemplate() {
    return [
      {
        dayId: 'mon',
        shortName: '週一',
        dayType: '主訓練日',
        theme: '下肢肌力 ＋ 核心穩定 ＋ 膝關節防護',
        focusMuscles: '股四頭肌、臀大肌、深層核心、膝周邊穩定肌',
        exercises: [
          { id: 'e-mon-1', category: '運動防護及恢復', name: '動態暖身及靜態伸展', purpose: '提升體溫潤滑關節，並於課後釋放腿部張力', method: '課前做世界最棒伸展、開合跳與高抬腿 8 分鐘；課後做大腿前後側與臀肌靜態伸展各 30 秒。', sets: 2, repsTime: '前 8 分／後 8 分', rest: '無', intensity: '低' },
          { id: 'e-mon-2', category: '跳繩訓練', name: '基本跳繩', purpose: '建立前腳掌彈性著地與腳步輕盈節奏', method: '雙腳併攏，手腕小幅畫圓搖繩，前腳掌輕盈起跳離地約 2–3 公分，膝微彎吸震。', sets: 3, repsTime: '60 秒', rest: '45 秒', intensity: '低' },
          { id: 'e-mon-3', category: '下肢肌力訓練', name: '深蹲', purpose: '強化起跳殺球推蹬力與低重心防守穩定', method: '雙腳略寬於肩、腳尖微外八，吸氣屈髖下蹲至大腿平行地面，核心收緊、踩穩腳跟站起。', sets: 4, repsTime: '12–15 次', rest: '75 秒', intensity: '中' },
          { id: 'e-mon-4', category: '下肢肌力訓練', name: '弓箭步', purpose: '模擬羽球網前大跨步減速與回位蹬地力量', method: '單腳向前大步跨出、腳跟落地緩衝下蹲（膝蓋對齊腳尖不內扣），前腳發力蹬回站姿交替。', sets: 3, repsTime: '每腳 10 次', rest: '60 秒', intensity: '中' },
          { id: 'e-mon-5', category: '運動防護及恢復', name: '膝關節周邊肌群訓練', purpose: '強化股內側肌（VMO）與臀中肌，預防跳躍膝與膝蓋內扣', method: '彈力帶側向螃蟹走每側 12 步，接續靠牆微蹲（膝彎 45 度）夾球靜止 30 秒。', sets: 3, repsTime: '12 步＋30 秒', rest: '45 秒', intensity: '低' },
          { id: 'e-mon-6', category: '核心訓練', name: '棒式', purpose: '建立軀幹中立抗伸展能力，保護殺球時腰椎安全', method: '前臂撐地、手肘置於肩正下方，頭肩髖踝成一直線，夾緊腹臀順暢呼吸不塌腰。', sets: 3, repsTime: '50 秒', rest: '45 秒', intensity: '中' },
          { id: 'e-mon-7', category: '核心訓練', name: '側棒式', purpose: '強化腹斜肌與骨盆側向穩定，支援左右大步救球', method: '側躺單前臂支撐抬起骨盆使身體成一直線，維持核心繃緊，左右各做一側為 1 組。', sets: 3, repsTime: '每側 40 秒', rest: '45 秒', intensity: '中' }
        ]
      },
      {
        dayId: 'tue',
        shortName: '週二',
        dayType: '主訓練日',
        theme: '羽球步伐啟動 ＋ 敏捷反應 ＋ 踝關節防護',
        focusMuscles: '腳踝穩定肌、小腿彈性、神經反應與協調核心',
        exercises: [
          { id: 'e-tue-1', category: '跳繩訓練', name: '單腳跳繩', purpose: '強化單腳落地穩定度與場上步法銜接流暢度', method: '左腳連跳 10 下換右腳連跳 10 下交替進行，保持上身直立不左右搖晃。', sets: 4, repsTime: '45 秒', rest: '45 秒', intensity: '中' },
          { id: 'e-tue-2', category: '羽球專項步伐訓練', name: '啟動步伐', purpose: '養成對手擊球瞬間微跳墊步習慣，加速第一步反應', method: '中場預備姿勢，隨節奏輕跳雙腳落地微寬於肩、重心下降，隨即向指定方向跨出第一步。', sets: 4, repsTime: '12 次', rest: '45 秒', intensity: '中' },
          { id: 'e-tue-3', category: '羽球專項步伐訓練', name: '左右側向移動', purpose: '提升中場防守並步速度與低重心橫向覆蓋面積', method: '於單打邊線間採羽球低重心並步左右來回觸線，落地外腳確實煞車後迅速蹬回。', sets: 4, repsTime: '30 秒', rest: '60 秒', intensity: '中' },
          { id: 'e-tue-4', category: '敏捷及反應訓練', name: '敏捷梯', purpose: '提升步頻、足底神經徵召與下肢多向協調', method: '去程採「進進出出」快步通過敏捷梯，回程採側向高頻碎步，全程目視前方不低頭。', sets: 4, repsTime: '來回 2 趟', rest: '60 秒', intensity: '中' },
          { id: 'e-tue-5', category: '敏捷及反應訓練', name: '教練指令方向反應', purpose: '縮短視覺／聽覺判斷至身體啟動的反應延遲', method: '站於場地中央，依教練口令或手勢（前左／前右／後左／後右）立即啟動步衝刺觸點並回中。', sets: 4, repsTime: '6 次指令', rest: '60 秒', intensity: '高' },
          { id: 'e-tue-6', category: '核心訓練', name: '死蟲式', purpose: '強化四肢高速移動時的核心抗伸展與對側協調', method: '仰臥屈髖屈膝 90 度、下背全程緊貼地面，緩慢同步伸直對側手腳後收回換邊。', sets: 3, repsTime: '左右共 16 次', rest: '45 秒', intensity: '低' },
          { id: 'e-tue-7', category: '運動防護及恢復', name: '踝關節穩定訓練', purpose: '提升本體感覺與腳踝抗翻船能力，預防急停扭傷', method: '單腳站立（進階可閉眼或站軟墊），另一腳向前後左右四方向輕點地面。', sets: 3, repsTime: '每腳 40 秒', rest: '30 秒', intensity: '低' }
        ]
      },
      {
        dayId: 'wed',
        shortName: '週三',
        dayType: '主動恢復',
        theme: '主動恢復日：肩髖運動防護 ＋ 低強度協調',
        focusMuscles: '肩袖肌群、髖關節活動度、全身柔軟度',
        exercises: [
          { id: 'e-wed-1', category: '跳繩訓練', name: '開合跳繩', purpose: '低衝擊維持手腳節奏協調並促進全身血流循環', method: '配合搖繩節奏做雙腳開合跳躍，速度輕鬆、肩頸放鬆，維持順暢呼吸。', sets: 3, repsTime: '60 秒', rest: '45 秒', intensity: '低' },
          { id: 'e-wed-2', category: '運動防護及恢復', name: '肩關節穩定訓練', purpose: '強化棘下肌、小圓肌與肩胛穩定，預防殺球肩夾擠', method: '使用輕彈力帶做手肘夾緊 90 度肩外旋 15 次，搭配趴姿 Y-T-W 肩胛上抬各 8 次。', sets: 3, repsTime: '每動作 12–15 次', rest: '45 秒', intensity: '低' },
          { id: 'e-wed-3', category: '運動防護及恢復', name: '髖關節活動度', purpose: '增加髖內外旋角度，改善網前跨步深度並減輕膝蓋代償', method: '坐姿 90/90 髖關節左右翻轉 10 次，搭配高跪姿髖屈肌動態前推每側 8 次。', sets: 3, repsTime: '60 秒', rest: '30 秒', intensity: '低' },
          { id: 'e-wed-4', category: '運動防護及恢復', name: '動態暖身及靜態伸展', purpose: '釋放週一二累積之肌肉緊繃，加速神經與軟組織恢復', method: '泡棉滾筒放鬆小腿、大腿與背闊肌後，針對胸肌、腿後肌、臀大肌靜態伸展各 40 秒。', sets: 2, repsTime: '10 分鐘', rest: '無', intensity: '低' }
        ]
      },
      {
        dayId: 'thu',
        shortName: '週四',
        dayType: '高強專項',
        theme: '下肢爆發力 ＋ 單側肌力 ＋ 下腹核心',
        focusMuscles: '下肢快縮肌群、股四頭、臀肌、小腿、下腹肌',
        exercises: [
          { id: 'e-thu-1', category: '爆發力訓練', name: '原地垂直跳', purpose: '強化垂直起跳爆發力，直接提升後場跳殺擊球點', method: '雙腳與肩同寬，快速擺臂微蹲後全力向上垂直躍起伸手觸高，屈膝安靜軟著地。', sets: 4, repsTime: '6 次', rest: '90 秒', intensity: '高' },
          { id: 'e-thu-2', category: '爆發力訓練', name: '立定跳遠', purpose: '發展水平蹬地推進爆發力，強化網前搶撲與大跨步', method: '雙手後擺蓄力向前上方全力跳出，雙腳同時屈膝穩定落地定住 2 秒確認平衡。', sets: 4, repsTime: '5 次', rest: '90 秒', intensity: '高' },
          { id: 'e-thu-3', category: '爆發力訓練', name: '蹲跳', purpose: '提升連續起跳彈跳力與伸展收縮循環（SSC）效率', method: '下蹲至半蹲位置後爆發性向上跳起，落地順勢屈膝緩衝接續下一跳，維持節奏與穩定。', sets: 3, repsTime: '8 次', rest: '90 秒', intensity: '高' },
          { id: 'e-thu-4', category: '下肢肌力訓練', name: '保加利亞分腿蹲', purpose: '強化單腳承重肌力與骨盆穩定，消除左右腳肌力不均', method: '後腳背置於長凳上，前腳跨出適當距離，軀幹微前傾垂直下蹲至前大腿平行地面後蹬起。', sets: 3, repsTime: '每腳 10 次', rest: '75 秒', intensity: '高' },
          { id: 'e-thu-5', category: '下肢肌力訓練', name: '小腿提踵', purpose: '強化腓腸肌與比目魚肌，支撐全場前腳掌起跳與墊步', method: '前腳掌站於階梯邊緣，向上墊腳至最高點停 1 秒，再控制 3 秒緩慢下放至微伸展。', sets: 3, repsTime: '15 次', rest: '45 秒', intensity: '中' },
          { id: 'e-thu-6', category: '核心訓練', name: '仰臥抬腿', purpose: '強化下腹與髖屈肌控制，支援空中跳殺收腹折體發力', method: '仰臥下背壓緊地面，雙腿伸直緩慢上抬至 90 度，再控制下放至距地 15 公分不拱腰。', sets: 3, repsTime: '12–15 次', rest: '45 秒', intensity: '中' }
        ]
      },
      {
        dayId: 'fri',
        shortName: '週五',
        dayType: '高強專項',
        theme: '羽球間歇心肺 ＋ 前後場移動 ＋ 旋轉核心',
        focusMuscles: '無氧與有氧心肺系統、前後場肌耐力、腹斜旋轉肌',
        exercises: [
          { id: 'e-fri-1', category: '跳繩訓練', name: '間歇跳繩', purpose: '建立高心率下的前腳掌節奏與快速換氣能力', method: '全力快跳 20 秒接輕鬆慢跳 20 秒不中斷，完成 3 循環為 1 組。', sets: 3, repsTime: '2 分鐘', rest: '60 秒', intensity: '高' },
          { id: 'e-fri-2', category: '心肺耐力訓練', name: '跳繩間歇訓練', purpose: '模擬羽球單打多拍高強度對抽的能量代謝節奏', method: '以 90% 速度（或雙迴旋）衝刺跳 15 秒、原地休息 30 秒，連續 6 回合為 1 大組。', sets: 2, repsTime: '6 回合（4 分半）', rest: '120 秒', intensity: '高' },
          { id: 'e-fri-3', category: '心肺耐力訓練', name: '間歇跑', purpose: '提升無氧耐力與多局比賽抗疲勞續航力', method: '85% 最大速度衝刺 20 秒後轉慢跑恢復 40 秒，連續執行 5 趟為 1 組。', sets: 2, repsTime: '5 趟（5 分鐘）', rest: '180 秒', intensity: '高' },
          { id: 'e-fri-4', category: '心肺耐力訓練', name: '短距離衝刺', purpose: '強化場上全速追球與最後階段爆發加速能力', method: '採羽球預備姿勢起跑，全力衝刺 15–20 公尺後自然減速，慢走回起點確保恢復。', sets: 5, repsTime: '1 趟（約 4 秒）', rest: '75 秒', intensity: '高' },
          { id: 'e-fri-5', category: '羽球專項步伐訓練', name: '前後場折返移動', purpose: '強化後場起跳殺球銜接上網撲球的連貫步伐轉換', method: '從後場底線模擬殺球後迅速上網跨步搓球，再墊步後退回底線連續執行。', sets: 4, repsTime: '30 秒', rest: '60 秒', intensity: '高' },
          { id: 'e-fri-6', category: '核心訓練', name: '俄羅斯轉體', purpose: '強化腹內外斜肌旋轉耐力，提升連續殺球與抽球轉體力量', method: '坐姿微後傾 45 度挺胸，雙腳微離地或點地，以胸椎帶動雙手控制左右轉體觸地。', sets: 3, repsTime: '左右共 20 次', rest: '45 秒', intensity: '中' }
        ]
      },
      {
        dayId: 'sat',
        shortName: '週六',
        dayType: '主訓練日',
        theme: '六點專項步伐 ＋ 反應燈敏捷 ＋ 單腳爆發',
        focusMuscles: '全場移動協調、單腳彈性、視覺反應速度',
        exercises: [
          { id: 'e-sat-1', category: '爆發力訓練', name: '單腳跳躍', purpose: '強化單側起跳蹬地與弓箭步回中瞬發推力', method: '單腳微蹲向前連續跳躍 3 步（或左右單腳跳），每次落地停頓 1 秒穩定膝踝再跳。', sets: 3, repsTime: '每腳 6 次', rest: '75 秒', intensity: '高' },
          { id: 'e-sat-2', category: '羽球專項步伐訓練', name: '六點移動步伐', purpose: '完整整合全場六角進攻與防守步伐連貫性', method: '由中場依序移動至右前、左前、右中、左中、右後、左後六點揮拍觸地，每點皆須回中。', sets: 4, repsTime: '2 輪（12 點）', rest: '75 秒', intensity: '高' },
          { id: 'e-sat-3', category: '羽球專項步伐訓練', name: '回中步伐', purpose: '強化擊球落地後的重心回收效率，減少場上空檔', method: '自網前跨步或後場側身落地點出發，刻意練習前腳反推蹬地「一步半內」搶回中心點並接啟動步。', sets: 4, repsTime: '10 次（四角輪換）', rest: '45 秒', intensity: '中' },
          { id: 'e-sat-4', category: '敏捷及反應訓練', name: '短距離折返跑', purpose: '強化急停轉向、重壓重心與二次加速能力', method: '進行 5-10-5 折返跑（中線→右 5m→左 10m→中線），觸線時身體壓低面向內側轉身。', sets: 4, repsTime: '1 趟（約 8 秒）', rest: '75 秒', intensity: '高' },
          { id: 'e-sat-5', category: '敏捷及反應訓練', name: '反應燈訓練', purpose: '模擬比賽隨機來球，訓練視覺捕捉與高速變向決策', method: '於場內架設 4–6 顆反應燈（或改由隊友隨機舉色卡），亮燈即以羽球步伐觸滅並立刻回中。', sets: 4, repsTime: '30 秒', rest: '60 秒', intensity: '高' }
        ]
      },
      {
        dayId: 'sun',
        shortName: '週日',
        dayType: '休息修復',
        theme: '完全休息與輕度伸展修復日',
        focusMuscles: '神經修復、關節活動度維持、充足睡眠',
        exercises: [
          { id: 'e-sun-1', category: '運動防護及恢復', name: '髖關節活動度', purpose: '溫和維持骨盆與髖部靈活度，消除整週訓練僵硬', method: '輕柔執行貓牛式、嬰兒式與 90/90 髖部轉換，全程配合深長腹式呼吸不勉強拉扯。', sets: 2, repsTime: '5 分鐘', rest: '無', intensity: '低' },
          { id: 'e-sun-2', category: '運動防護及恢復', name: '動態暖身及靜態伸展', purpose: '完整放鬆全身緊繃肌群，迎接下週新階段課表', method: '全身靜態伸展（肩胸、前臂、臀腿、小腿各 30–40 秒），並補充水分與 8 小時以上睡眠。', sets: 1, repsTime: '12 分鐘', rest: '無', intensity: '低' }
        ]
      }
    ];
  }

  // 依據指定週一日期建立完整一週物件（可帶入自訂模板，預設使用標準羽球模板）
  function buildWeekObject(mondayIso, phaseId, sourceDays = null, autoGenerated = true) {
    const labels = getWeekDayLabels(mondayIso);
    const tpl = sourceDays ? JSON.parse(JSON.stringify(sourceDays)) : getMasterWeekTemplate();
    const days = tpl.map((d, idx) => ({
      ...d,
      dateLabel: labels[idx] || d.dateLabel
    }));
    return {
      weekKey: mondayIso,
      weekLabel: formatWeekRangeLabel(mondayIso),
      phase: phaseId || 'w2',
      autoGenerated,
      days
    };
  }

  function createDefaultPlayers(currentWeekKey) {
    return [
      {
        id: 'p-lin',
        name: '林子軒',
        level: 'varsity',
        weeklyLogs: {
          [currentWeekKey]: {
            'e-mon-1': { completed: true, actualReps: '前後各 8 分', actualTime: '16 分', updatedAt: '2026/11/23' },
            'e-mon-2': { completed: true, actualReps: '3 組 × 60 秒', actualTime: '4 分', updatedAt: '2026/11/23' },
            'e-mon-3': { completed: true, actualReps: '4 組 × 15 次', actualTime: '7 分', updatedAt: '2026/11/23' },
            'e-mon-4': { completed: true, actualReps: '3 組 × 10 次', actualTime: '6 分', updatedAt: '2026/11/23' },
            'e-mon-5': { completed: true, actualReps: '3 組完成', actualTime: '5 分', updatedAt: '2026/11/23' },
            'e-mon-6': { completed: true, actualReps: '3 組 × 55 秒', actualTime: '4 分', updatedAt: '2026/11/23' },
            'e-mon-7': { completed: true, actualReps: '3 組 × 40 秒', actualTime: '5 分', updatedAt: '2026/11/23' },
            'e-tue-1': { completed: true, actualReps: '4 組 × 45 秒', actualTime: '5 分', updatedAt: '2026/11/24' },
            'e-tue-2': { completed: true, actualReps: '4 組 × 12 次', actualTime: '5 分', updatedAt: '2026/11/24' },
            'e-tue-3': { completed: true, actualReps: '4 組 × 30 秒', actualTime: '6 分', updatedAt: '2026/11/24' }
          }
        },
        weeklyCheckins: {
          [currentWeekKey]: {
            mon: { fatigue: 7, hasPain: false, painParts: [], painDesc: '', journal: '深蹲與弓箭步下肢充血感很好，膝關節穩定。', updatedAt: '2026/11/23' }
          }
        },
        fitnessTests: [
          { date: '10/20', broadJump: 226, verticalJump: 56, sixPointSec: 24.6, plankSec: 75 },
          { date: '10/27', broadJump: 230, verticalJump: 57, sixPointSec: 24.1, plankSec: 85 },
          { date: '11/03', broadJump: 234, verticalJump: 59, sixPointSec: 23.7, plankSec: 95 },
          { date: '11/10', broadJump: 238, verticalJump: 60, sixPointSec: 23.3, plankSec: 105 },
          { date: '11/17', broadJump: 242, verticalJump: 62, sixPointSec: 22.8, plankSec: 115 },
          { date: '11/24', broadJump: 246, verticalJump: 64, sixPointSec: 22.4, plankSec: 125 }
        ]
      },
      {
        id: 'p-chen',
        name: '陳品妍',
        level: 'elite',
        weeklyLogs: {
          [currentWeekKey]: {
            'e-mon-1': { completed: true, actualReps: '前後各 8 分', actualTime: '16 分', updatedAt: '2026/11/23' },
            'e-mon-2': { completed: true, actualReps: '4 組 × 60 秒', actualTime: '6 分', updatedAt: '2026/11/23' },
            'e-mon-3': { completed: true, actualReps: '5 組 × 12 次', actualTime: '9 分', updatedAt: '2026/11/23' },
            'e-mon-4': { completed: true, actualReps: '4 組 × 10 次', actualTime: '8 分', updatedAt: '2026/11/23' },
            'e-mon-5': { completed: true, actualReps: '4 組完成', actualTime: '6 分', updatedAt: '2026/11/23' },
            'e-mon-6': { completed: true, actualReps: '4 組 × 60 秒', actualTime: '6 分', updatedAt: '2026/11/23' },
            'e-mon-7': { completed: true, actualReps: '4 組 × 45 秒', actualTime: '7 分', updatedAt: '2026/11/23' },
            'e-tue-1': { completed: true, actualReps: '5 組 × 45 秒', actualTime: '7 分', updatedAt: '2026/11/24' },
            'e-tue-2': { completed: true, actualReps: '5 組 × 12 次', actualTime: '6 分', updatedAt: '2026/11/24' },
            'e-tue-3': { completed: true, actualReps: '5 組 × 30 秒', actualTime: '7 分', updatedAt: '2026/11/24' },
            'e-tue-4': { completed: true, actualReps: '5 組 × 2 趟', actualTime: '7 分', updatedAt: '2026/11/24' },
            'e-tue-5': { completed: true, actualReps: '5 組 × 6 指令', actualTime: '7 分', updatedAt: '2026/11/24' },
            'e-tue-6': { completed: true, actualReps: '4 組 × 16 次', actualTime: '5 分', updatedAt: '2026/11/24' },
            'e-tue-7': { completed: true, actualReps: '4 組 × 40 秒', actualTime: '5 分', updatedAt: '2026/11/24' }
          }
        },
        weeklyCheckins: {
          [currentWeekKey]: {
            mon: { fatigue: 7, hasPain: false, painParts: [], painDesc: '', journal: '整體順暢，側棒式每側加碼至 45 秒。', updatedAt: '2026/11/23' }
          }
        },
        fitnessTests: [
          { date: '10/20', broadJump: 198, verticalJump: 46, sixPointSec: 23.8, plankSec: 90 },
          { date: '10/27', broadJump: 202, verticalJump: 47, sixPointSec: 23.4, plankSec: 95 },
          { date: '11/03', broadJump: 205, verticalJump: 49, sixPointSec: 23.0, plankSec: 105 },
          { date: '11/10', broadJump: 208, verticalJump: 50, sixPointSec: 22.7, plankSec: 115 },
          { date: '11/17', broadJump: 212, verticalJump: 52, sixPointSec: 22.3, plankSec: 125 },
          { date: '11/24', broadJump: 216, verticalJump: 53, sixPointSec: 21.9, plankSec: 135 }
        ]
      },
      {
        id: 'p-chang',
        name: '張宇辰',
        level: 'youth',
        weeklyLogs: {
          [currentWeekKey]: {
            'e-mon-1': { completed: true, actualReps: '前後各 8 分', actualTime: '16 分', updatedAt: '2026/11/23' },
            'e-mon-2': { completed: true, actualReps: '2 組 × 60 秒', actualTime: '3 分', updatedAt: '2026/11/23' },
            'e-mon-3': { completed: true, actualReps: '3 組 × 12 次', actualTime: '5 分', updatedAt: '2026/11/23' },
            'e-mon-5': { completed: true, actualReps: '2 組完成', actualTime: '4 分', updatedAt: '2026/11/23' },
            'e-mon-6': { completed: true, actualReps: '2 組 × 45 秒', actualTime: '3 分', updatedAt: '2026/11/23' }
          }
        },
        weeklyCheckins: {
          [currentWeekKey]: {
            mon: { fatigue: 7, hasPain: true, painParts: ['膝關節前側'], painDesc: '弓箭步下蹲過深時右膝微酸，已先改半蹲角度', journal: '已通知教練調整跨步深度並加強股內側肌訓練。', updatedAt: '2026/11/23' }
          }
        },
        fitnessTests: [
          { date: '10/20', broadJump: 176, verticalJump: 38, sixPointSec: 27.4, plankSec: 45 },
          { date: '10/27', broadJump: 179, verticalJump: 39, sixPointSec: 26.9, plankSec: 52 },
          { date: '11/03', broadJump: 182, verticalJump: 41, sixPointSec: 26.5, plankSec: 58 },
          { date: '11/10', broadJump: 185, verticalJump: 42, sixPointSec: 26.0, plankSec: 66 },
          { date: '11/17', broadJump: 188, verticalJump: 43, sixPointSec: 25.6, plankSec: 72 },
          { date: '11/24', broadJump: 192, verticalJump: 45, sixPointSec: 25.1, plankSec: 82 }
        ]
      }
    ];
  }

  return {
    CATEGORIES,
    PAIN_PARTS,
    PHASE_ORDER,
    WEEK_PHASES,
    LEVELS,
    FITNESS_METRICS,
    getMondayIso,
    addWeeksToIso,
    diffWeeksBetween,
    computeAutoPhase,
    formatWeekRangeLabel,
    getWeekDayLabels,
    getMasterWeekTemplate,
    buildWeekObject,
    createDefaultPlayers
  };
})();
