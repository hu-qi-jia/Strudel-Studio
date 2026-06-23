// attachments.mjs — 附件会话 API。
//
// 流程：ChatInput 上传文件 → registerAttachment(file)（blob 入 IDB）→ 返回纯 JSON 元数据
// {handleId,mime,name,size}。元数据挂在 user 消息上（可持久化）；二进制留 IDB，按 handleId 取。
// 工具侧用 ctx.attachments.read(handleId) 取 ArrayBuffer（见 ToolContext）。
//
// 设计：消息只存纯 JSON 元数据（storage.mjs 深拷贝持久化需要），二进制与消息解耦。

import { saveAttachment, loadAttachment, deleteAttachment } from './storage.mjs';
import { MAX_ATTACHMENT_BYTES } from './config.mjs';

// 本会话已注册附件的内存索引（reload 后失效，但消息自带元数据，UI 不依赖此表）
const HANDLES = new Map();

function newHandleId() {
  return 'att_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 注册一个文件，返回可序列化的元数据。超过 MAX_ATTACHMENT_BYTES 抛错（调用方应捕获提示）。 */
export async function registerAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `attachment too large: ${file.size} bytes (max ${MAX_ATTACHMENT_BYTES})`,
    );
  }
  const handleId = newHandleId();
  const data = await file.arrayBuffer();
  const meta = {
    handleId,
    mime: file.type || 'application/octet-stream',
    name: file.name,
    size: file.size,
  };
  await saveAttachment({ ...meta, data, createdAt: Date.now() });
  HANDLES.set(handleId, meta);
  return meta;
}

/** 按 handleId 取原始字节（ArrayBuffer）。 */
export async function readAttachment(handleId) {
  const rec = await loadAttachment(handleId);
  if (!rec) throw new Error(`attachment not found: ${handleId}`);
  return rec.data;
}

/** 按 handleId 取元数据（本会话内）。 */
export function getAttachmentMeta(handleId) {
  return HANDLES.get(handleId) || null;
}

/** 删除附件（IDB + 内存索引）。 */
export async function removeAttachment(handleId) {
  HANDLES.delete(handleId);
  try {
    await deleteAttachment(handleId);
  } catch (e) {
    console.warn('[attachments] failed to delete:', e);
  }
}

/**
 * 给 ToolContext 用的收窄接口（只暴露 list/read/meta）。
 * 注意语义不一致：list()/meta() 只反映「本会话上传」的附件（HANDLES 内存索引，reload 后为空），
 * 而 read(handleId) 可读 IDB 里持久化的任意附件（含历史会话）。当前 LLM 靠消息里的 handleId
 * 调 read，故不受影响；未来若有插件依赖 list() 遍历，需把 list() 也改为读 IDB（异步化）。
 */
export const attachmentsCapability = {
  list: () => Array.from(HANDLES.values()),
  read: readAttachment,
  meta: (handleId) => getAttachmentMeta(handleId) || null,
};
