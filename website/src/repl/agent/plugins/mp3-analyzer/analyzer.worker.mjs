// analyzer.worker.mjs — 音频分析 worker（M2）。
//
// 跑纯计算 analyzePCM，把主线程从 ~100ms 的同步分析中解放出来，避免阻塞与主线程
// 共享的 Strudel 实时音频调度器（否则播放会抖动/丢拍）。PCM 声道以 transferable
// 零拷贝传入；失败回传 error，由主线程 client（analyzer.mjs:runInWorker）统一处理/降级。
//
// 只 import analyzePCM（纯计算）——analyzer.mjs 里其余对浏览器的依赖（Worker、URL）
// 都在 analyze() 主线程入口里，worker 加载 analyzer.mjs 时不会触发它们。

import { analyzePCM } from './analyzer.mjs';

self.onmessage = (e) => {
  const { id, channels, sampleRate, durationSec } = e.data || {};
  try {
    const result = analyzePCM({ channels, sampleRate, durationSec });
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
