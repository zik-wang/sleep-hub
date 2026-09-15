const run = {
  armed: false,
  test: false,
  recipe: null,
  index: 0,
  stepStarted: 0,
  dawnFrom: 0,
  dawnMs: 0,
  fired: false,
  httpDone: true,
  edgeArmed: true,
  edgeAfter: 0,
  audio: null,
  wakeLock: null,
};

function ensureAudio() {
  if (run.audio) return run.audio;
  run.audio = new (window.AudioContext || window.webkitAudioContext)();
  return run.audio;
}

function beep(seconds) {
  const ctx = ensureAudio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.value = 0.12;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  setTimeout(() => osc.stop(), Math.max(0.4, seconds) * 1000);
}

function setDawn(progress) {
  const el = document.getElementById("dawn");
  const p = Math.max(0, Math.min(1, progress));
  const target = Math.min(1, p * 1.15);
  const cur = Number(el.style.opacity || 0);
  // JS already steps dawn every ~200ms. A CSS transition longer than that
  // restarts from an old opacity on WebKit (phone 压缩试跑 looks like a flashback).
  el.style.transition = target + 0.04 < cur ? "opacity 0.45s linear" : "none";
  el.style.opacity = String(target);
  const warm = 28 + p * 52;
  el.style.background =
    `radial-gradient(120% 80% at 50% 110%, hsl(38, 95%, ${22 + p * 48}%), transparent 62%),` +
    `linear-gradient(180deg, hsl(${32 + p * 16}, 88%, ${warm}%), hsl(22, 78%, ${12 + p * 36}%))`;
}

async function keepAwake() {
  if (document.hidden) return;
  try {
    if (navigator.wakeLock) {
      run.wakeLock = await navigator.wakeLock.request("screen");
      logLine("已请求屏幕保持唤醒（笔记本电源里仍要关掉睡眠）");
    }
  } catch (e) {
    logLine("Wake Lock 失败：" + e.message);
  }
}

function nearStart(step) {
  const wake = todayAt(step.time);
  const mins = Number(step.minutes);
  const n = Number.isFinite(mins) && mins > 0 ? mins : 20;
  return new Date(wake.getTime() - n * 60 * 1000);
}

function todayAt(hhmm) {
  const [h, m] = String(hhmm || "07:00").split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() <= Date.now() - 60 * 1000) d.setDate(d.getDate() + 1);
  return d;
}

function enterStep() {
  run.stepStarted = Date.now();
  run.fired = false;
  run.httpDone = true;
  run.edgeArmed = true;
  run.edgeAfter = 0;
  const step = currentStep();
  if (!step) return;
  logLine("进入步骤 " + (run.index + 1) + "：" + stepLabel(step));
  if (step.type === "wait_fact" && step.fact === "motion") {
    run.edgeArmed = !factEquals("motion", true);
    run.edgeAfter = Date.now() + 800;
  }
  if (step.type === "screen_dawn") {
    run.dawnFrom = Date.now();
    run.dawnMs = stepDurationMs(step);
    run.lampBucket = -1;
    run.lampAt = 0;
  }
  syncRunChrome();
}

function currentStep() {
  return run.recipe && run.recipe.steps[run.index];
}

function stepLabel(step) {
  const meta = STEP_TYPES.find((x) => x.id === step.type);
  const name = meta ? meta.label : step.type;
  if (step.type === "wait_until") return name + " " + step.time;
  if (step.type === "wait_near") return name + " " + (step.time || "") + " 前 " + (step.minutes || 20) + " 分钟";
  if (step.type === "wait_minutes") return name + " " + step.minutes;
  if (step.type === "wait_seconds") return name + " " + step.seconds;
  if (step.type === "wait_fact") {
    if (step.fact === "stage") return name + " stage=" + (step.equals || "");
    return name + " " + step.fact + "=" + (step.equals ? "是" : "否");
  }
  if (step.type === "screen_dawn") return name + " " + step.durationMin + " 分钟";
  if (step.type === "pc_beep") return name + " " + step.seconds + " 秒";
  if (step.type === "http_out") return name + " " + (step.url || "");
  return name;
}

function stepDurationMs(step) {
  const compress = run.test;
  if (step.type === "wait_minutes") {
    const m = Number(step.minutes) || 0;
    return compress ? Math.max(1500, m * 2000) : m * 60 * 1000;
  }
  if (step.type === "wait_seconds") {
    const s = Number(step.seconds) || 0;
    return compress ? Math.max(400, s * 200) : s * 1000;
  }
  if (step.type === "screen_dawn") {
    const m = Number(step.durationMin) || 1;
    return compress ? Math.max(5000, Math.min(14000, m * 500)) : m * 60 * 1000;
  }
  if (step.type === "wait_until") {
    if (compress) return 6000;
    return Math.max(0, todayAt(step.time).getTime() - Date.now());
  }
  if (step.type === "wait_near") {
    if (compress) return 5000;
    return Math.max(0, nearStart(step).getTime() - Date.now());
  }
  return 0;
}

function advance() {
  run.index += 1;
  if (run.index >= run.recipe.steps.length) {
    finish("方案跑完");
    return;
  }
  enterStep();
}

function finish(msg) {
  run.armed = false;
  if (run.dawnMs) setDawn(1);
  syncRunChrome();
  logLine(msg);
}

function kickRunLoop() {
  const hop = () => {
    if (!run.armed) return;
    if (typeof tick === "function") tick();
    else tickRun();
    if (run.armed) setTimeout(hop, 200);
  };
  setTimeout(hop, 0);
}

function syncRunChrome() {
  document.body.classList.toggle("armed", Boolean(run.armed));
  const step = currentStep();
  document.body.classList.toggle("dawning", Boolean(run.armed && step && step.type === "screen_dawn"));
}

function armRecipe(recipe, test) {
  ensureAudio();
  keepAwake();
  setDawn(0);
  if (Notification.permission === "default") Notification.requestPermission();
  run.armed = true;
  run.test = Boolean(test);
  run.recipe = JSON.parse(JSON.stringify(recipe));
  run.index = 0;
  if (!run.recipe.steps.length) {
    finish("方案是空的，先加步骤");
    return;
  }
  logLine(
    (run.test ? "试跑开始（等待已压缩成秒）" : "守夜开始") + " · " + run.recipe.name
  );
  enterStep();
  syncRunChrome();
  kickRunLoop();
}

function cancelRun() {
  run.armed = false;
  setDawn(0);
  stopDemoNight();
  syncRunChrome();
  logLine("取消");
}

let tickBusy = false;

function tickRun() {
  if (!run.armed) return "未守夜";
  if (tickBusy) return "运行中";
  tickBusy = true;
  try {
    return tickRunInner();
  } finally {
    tickBusy = false;
  }
}

function tickRunInner() {
  const step = currentStep();
  if (!step) return "方案跑完";
  const t = Date.now();

  if (step.type === "wait_until") {
    const left = stepDurationMs(step) - (t - run.stepStarted);
    if (run.test) {
      if (t - run.stepStarted >= stepDurationMs(step)) {
        advance();
        return tickRunInner();
      }
      return "等时钟（试跑）还剩 " + Math.ceil(left / 1000) + " 秒";
    }
    const target = todayAt(step.time);
    if (t >= target.getTime()) {
      advance();
      return tickRunInner();
    }
    return "等到 " + step.time + " · 还剩 " + Math.round((target - t) / 1000) + " 秒";
  }

  if (step.type === "wait_near") {
    const left = stepDurationMs(step) - (t - run.stepStarted);
    if (run.test) {
      if (t - run.stepStarted >= stepDurationMs(step)) {
        advance();
        return tickRunInner();
      }
      return "接近起床（试跑）还剩 " + Math.ceil(left / 1000) + " 秒";
    }
    const start = nearStart(step);
    if (t >= start.getTime()) {
      advance();
      return tickRunInner();
    }
    return (
      "接近 " +
      (step.time || "") +
      " 前 " +
      (step.minutes || 20) +
      " 分钟 · 还剩 " +
      Math.round((start - t) / 1000) +
      " 秒"
    );
  }

  if (step.type === "wait_minutes" || step.type === "wait_seconds") {
    const need = stepDurationMs(step);
    if (t - run.stepStarted >= need) {
      advance();
      return tickRunInner();
    }
    return "等待中 " + Math.ceil((need - (t - run.stepStarted)) / 1000) + " 秒";
  }

  if (step.type === "wait_fact") {
    const movingGate = step.fact === "motion" && step.equals !== false;
    if (movingGate) {
      if (t < run.edgeAfter) return "先确认静止，不动不亮";
      const moving = factEquals("motion", true);
      if (!moving) run.edgeArmed = true;
      if (!(run.edgeArmed && moving)) {
        return run.edgeArmed
          ? "静止中，等体动再亮（现在是 " + fmtFact("motion") + "）"
          : "体动还没结束，先等它回到静止";
      }
      logLine("体动出现，开始亮灯");
      advance();
      return tickRunInner();
    }
    if (factEquals(step.fact, step.equals)) {
      advance();
      return tickRunInner();
    }
    const want =
      step.fact === "stage" ? String(step.equals || "") : step.equals ? "是" : "否";
    return "在等事实 " + step.fact + "=" + want + "（现在是 " + fmtFact(step.fact) + "）";
  }

  if (step.type === "screen_dawn") {
    const p = run.dawnMs <= 0 ? 1 : (t - run.dawnFrom) / run.dawnMs;
    setDawn(p);
    pulseLamp(p);
    if (p >= 1) {
      setDawn(1);
      pulseLamp(1);
      advance();
      return tickRunInner();
    }
    return "黎明 " + Math.round(Math.min(1, p) * 100) + "%";
  }

  if (step.type === "pc_beep") {
    if (!run.fired) {
      run.fired = true;
      beep(Number(step.seconds) || 8);
      logLine("电脑响铃");
    }
    const hold = Math.max(800, (Number(step.seconds) || 8) * 200);
    if (t - run.stepStarted >= hold) {
      advance();
      return tickRunInner();
    }
    return "响铃中";
  }

  if (step.type === "notify") {
    if (!run.fired) {
      run.fired = true;
      if (Notification.permission === "granted") {
        new Notification(step.title || "中控", { body: step.body || "" });
      }
      logLine("通知：" + (step.title || ""));
    }
    advance();
    return tickRunInner();
  }

  if (step.type === "log") {
    if (!run.fired) {
      run.fired = true;
      logLine(step.text || "（空日志步）");
    }
    advance();
    return tickRunInner();
  }

  if (step.type === "http_out") {
    if (!run.fired) {
      run.fired = true;
      fireHttp(step);
    }
    if (run.httpDone || t - run.stepStarted >= 12000) {
      if (!run.httpDone) logLine("HTTP 等待超时");
      advance();
      return tickRunInner();
    }
    return "正在 HTTP 发出";
  }

  logLine("未知步骤 " + step.type + "，跳过");
  advance();
  return tickRunInner();
}

function fmtFact(key) {
  if (key === "presence") return bus.facts.presence ? "有人" : "无人";
  if (key === "motion") return bus.facts.motion ? "有体动" : "静止";
  if (key === "stage") return bus.facts.stage || "空";
  return String(bus.facts[key]);
}

function lampTargets() {
  return (run.recipe && run.recipe.steps ? run.recipe.steps : []).filter((st) => {
    if (st.type !== "http_out") return false;
    const url = expandApplyUrl(st.url || "");
    return /\/dawn/i.test(url) || /\{\s*"progress"/i.test(String(st.body || ""));
  });
}

function pulseLamp(p) {
  const lamps = lampTargets();
  if (!lamps.length) return;
  const clamped = Math.min(1, Math.max(0, p));
  const bucket = Math.floor(clamped * 10);
  const now = Date.now();
  if (bucket === run.lampBucket && now - (run.lampAt || 0) < 700) return;
  run.lampBucket = bucket;
  run.lampAt = now;
  const body = JSON.stringify({ progress: clamped });
  lamps.forEach((st) => {
    fetch("/api/out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: expandApplyUrl(st.url || ""), body }),
    }).catch(() => {});
  });
}

function fireHttp(step) {
  const url = expandApplyUrl(step.url || "");
  const body = step.body || "";
  const jsonish = body.trim().startsWith("{");
  run.httpDone = false;
  logLine("HTTP 发出 " + url);
  if (!url) {
    logLine("HTTP 失败：没有 URL");
    run.httpDone = true;
    return;
  }
  fetch("/api/out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, body }),
  })
    .then((res) =>
      res
        .json()
        .catch(() => ({}))
        .then((j) => ({ res, j }))
    )
    .then(({ res, j }) => {
      if (res.ok) {
        logLine("HTTP 已发出");
        run.httpDone = true;
        return;
      }
      logLine("代理失败 " + (j.error || res.status) + "，改直发");
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": jsonish ? "application/json" : "text/plain;charset=utf-8" },
        body: body || "{}",
      }).then(() => {
        logLine("HTTP 直发");
        run.httpDone = true;
      });
    })
    .catch((e) => {
      logLine("HTTP 失败：" + e.message);
      run.httpDone = true;
    });
}

onBus(() => {
  if (run.armed && typeof tick === "function") tick();
});
