export const logKey = 'strudel.log';

let debounce = 1000,
  lastMessage,
  lastTime;

// 同一条错误在一次 evaluate 周期内只打印一次。
// 背景调度器每个 cycle 都会触发同一个采样，加载失败时原本会每 cycle 重复打印
// 同一条 [getTrigger] error，把日志面板刷爆。这里用 Set 去重，由 repl.evaluate()
// 在每次（重新）求值时调用 resetErrorLog() 清空，从而"改代码后重新播放，错误能再出现一次"。
const seenErrors = new Set();

export function errorLogger(e, origin = 'cyclist') {
  //TODO: add some kind of debug flag that enables this  while in dev mode
  // console.error(e);
  const message = e?.message ?? String(e);
  const key = `${origin}::${message}`;
  if (seenErrors.has(key)) {
    return;
  }
  seenErrors.add(key);
  logger(`[${origin}] error: ${message}`);
}

// 每次重新求值（按播放 / 改代码自动求值）时调用：清空已见错误，让新一轮可以再次提示。
export function resetErrorLog() {
  seenErrors.clear();
}

export function logger(message, type, data = {}) {
  let t = performance.now();
  if (lastMessage === message && t - lastTime < debounce) {
    return;
  }
  lastMessage = message;
  lastTime = t;
  console.log(`%c${message}`, 'background-color: black;color:white;border-radius:15px');
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent(logKey, {
        detail: {
          message,
          type,
          data,
        },
      }),
    );
  }
}

logger.key = logKey;
