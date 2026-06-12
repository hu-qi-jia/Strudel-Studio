export const editorTools = [
  {
    type: 'function',
    function: {
      name: 'read_code',
      description: '读取编辑器中的当前代码',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_code',
      description: '替换编辑器中的全部代码。注意：Strudel 中没有 .reverb() 方法，混响请用 .room().size()；没有 .echo() 方法，延迟请用 .delay()',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要写入的完整代码' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_code',
      description: '在指定位置插入代码。注意：Strudel 中没有 .reverb() 方法，混响请用 .room().size()',
      parameters: {
        type: 'object',
        properties: {
          position: { type: 'number', description: '插入位置（字符偏移）' },
          code: { type: 'string', description: '要插入的代码' },
        },
        required: ['position', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_code',
      description: '替换指定范围的代码。注意：Strudel 中没有 .reverb() 方法，混响请用 .room().size()',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'number', description: '起始位置' },
          to: { type: 'number', description: '结束位置' },
          code: { type: 'string', description: '替换后的代码' },
        },
        required: ['from', 'to', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_code',
      description: '执行编辑器中的代码（播放）',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_playback',
      description: '停止播放',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// Strudel 中不存在的方法，会被解析为全局函数调用导致 "is not defined" 错误
const INVALID_METHODS = {
  reverb: 'Use .room(0.7).size(0.8) for reverb',
  echo: 'Use .delay(0.5).delaytime(0.25) for delay/echo',
  chorus: 'Not available in Strudel',
  flanger: 'Not available in Strudel',
  phaser: 'Not available in Strudel',
  compressor: 'Not available in Strudel',
  limiter: 'Not available in Strudel',
  wah: 'Not available in Strudel',
};

function validateCode(code) {
  const warnings = [];
  for (const [method, hint] of Object.entries(INVALID_METHODS)) {
    // 匹配 .methodName( 的调用模式
    const regex = new RegExp(`\\.${method}\\s*\\(`, 'i');
    if (regex.test(code)) {
      warnings.push(`.${method}() does not exist in Strudel — ${hint}`);
    }
  }
  return warnings;
}

export function executeTool(name, args, editorRef) {
  const editor = editorRef.current;
  if (!editor) return 'Editor not available';

  // 对写入类操作校验代码
  if (['write_code', 'insert_code', 'replace_code'].includes(name) && args.code) {
    const warnings = validateCode(args.code);
    if (warnings.length > 0) {
      return `Code validation failed:\n${warnings.join('\n')}\n\nPlease fix the code and try again.`;
    }
  }

  switch (name) {
    case 'read_code':
      return editor.editor.state.doc.toString();
    case 'write_code':
      editor.setCode(args.code);
      return 'Code written successfully';
    case 'insert_code':
      editor.editor.dispatch({
        changes: { from: args.position, insert: args.code },
      });
      return 'Code inserted successfully';
    case 'replace_code':
      editor.editor.dispatch({
        changes: { from: args.from, to: args.to, insert: args.code },
      });
      return 'Code replaced successfully';
    case 'execute_code':
      editor.evaluate();
      return 'Code execution started';
    case 'stop_playback':
      try {
        editor.repl.setActive(false);
      } catch {
        // ignore
      }
      return 'Playback stopped';
    default:
      return `Unknown tool: ${name}`;
  }
}
