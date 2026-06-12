import { memo, useEffect, useMemo, useState } from 'react';

import jsdocJson from '@root/jsdoc/doc.json';
import { Textbox } from '../textbox/Textbox';

// 从 meta.path + meta.filename 推断分类
const getCategory = (entry) => {
  const rawTags = entry.tags;
  if (Array.isArray(rawTags) && rawTags.length > 0) {
    const strTags = rawTags
      .map((t) => (typeof t === 'string' ? t : t?.title || ''))
      .filter(Boolean);
    if (strTags.length > 0 && !strTags.every((t) => ['superdirtonly', 'superdirtOnly', 'superdoughOnly'].includes(t))) {
      return strTags[0]; // 取第一个 tag 作为主分类
    }
  }

  const path = entry.meta?.path || '';
  const filename = entry.meta?.filename || '';

  if (path.includes('superdough')) return 'superdough';
  if (path.includes('motion')) return 'motion';
  if (path.includes('tonal')) return 'tonal';
  if (path.includes('draw')) return 'visualization';
  if (path.includes('midi')) return 'midi';
  if (path.includes('webaudio')) return 'audio';
  if (path.includes('codemirror')) return 'editor';
  if (path.includes('csound')) return 'csound';
  if (path.includes('osc')) return 'osc';

  if (filename === 'pattern.mjs') return 'pattern';
  if (filename === 'controls.mjs') return 'control';
  if (filename === 'signal.mjs') return 'signal';
  if (filename === 'pick.mjs') return 'pick';
  if (filename === 'euclid.mjs') return 'euclid';
  if (filename === 'repl.mjs' || filename === 'util.mjs' || filename === 'drawLine.mjs') return 'internal';

  return 'untagged';
};

const CATEGORY_ORDER = [
  'pattern', 'control', 'signal', 'pick', 'euclid',
  'superdough', 'tonal', 'motion', 'midi', 'audio',
  'visualization', 'editor', 'osc', 'csound',
  'internal', 'untagged',
];

const isValid = ({ name, description }) =>
  name && !name.startsWith('_') && !!description;

// 预处理函数列表
const availableFunctions = (() => {
  const seen = new Set();
  const functions = [];
  for (const doc of jsdocJson.docs) {
    if (!isValid(doc)) continue;
    if (seen.has(doc.name)) continue;
    seen.add(doc.name);

    doc._category = getCategory(doc);
    const synonyms = doc.synonyms || [];
    let names = [doc.name];
    for (const s of synonyms) {
      if (!s || seen.has(s)) continue;
      names.push(s);
      seen.add(s);
    }
    doc.allNames = names.join(', ');
    doc._synonyms = names.slice(1);
    functions.push(doc);
  }
  return functions.sort((a, b) => a.name.localeCompare(b.name));
})();

// 构建分类树：{ category: [entry, ...] }
const categoryTree = (() => {
  const tree = {};
  availableFunctions.forEach((entry) => {
    const cat = entry._category || 'untagged';
    if (!tree[cat]) tree[cat] = [];
    tree[cat].push(entry);
  });
  return tree;
})();

// 按预设顺序排列的分类列表
const sortedCategories = (() => {
  const ordered = [];
  CATEGORY_ORDER.forEach((cat) => {
    if (categoryTree[cat]) ordered.push(cat);
  });
  Object.keys(categoryTree).forEach((cat) => {
    if (!CATEGORY_ORDER.includes(cat)) ordered.push(cat);
  });
  return ordered;
})();

const getInnerText = (html) => {
  var div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

export const Reference = memo(function Reference() {
  const [search, setSearch] = useState('');
  const [selectedFunction, setSelectedFunction] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState(() => new Set());

  // 搜索过滤
  const filteredFunctions = useMemo(() => {
    if (!search.trim()) return availableFunctions;
    const q = search.toLowerCase();
    return availableFunctions.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        (entry.allNames || '').toLowerCase().includes(q) ||
        (entry._synonyms || []).some((s) => s.toLowerCase().includes(q)),
    );
  }, [search]);

  // 搜索时构建过滤后的分类树
  const filteredTree = useMemo(() => {
    if (!search.trim()) return categoryTree;
    const tree = {};
    filteredFunctions.forEach((entry) => {
      const cat = entry._category || 'untagged';
      if (!tree[cat]) tree[cat] = [];
      tree[cat].push(entry);
    });
    return tree;
  }, [filteredFunctions, search]);

  // 搜索时自动展开所有分类
  useEffect(() => {
    if (search.trim()) {
      setExpandedCategories(new Set(Object.keys(filteredTree)));
    }
  }, [search, filteredTree]);

  const toggleCategory = (cat) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleItemClick = (name) => {
    setSelectedFunction((prev) => (prev === name ? null : name));
  };

  // 选中的函数详情
  const selectedEntry = useMemo(() => {
    if (!selectedFunction) return null;
    return availableFunctions.find((f) => f.name === selectedFunction);
  }, [selectedFunction]);

  // 自动滚动到选中项
  useEffect(() => {
    if (!selectedFunction) return;
    const el = document.getElementById(`ref-item-${selectedFunction}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedFunction]);

  return (
    <div className="flex h-full w-full overflow-hidden text-[var(--fs-body)] text-foreground">
      {/* 左侧：搜索 + 分类树 */}
      <div className="h-full flex flex-col w-1/3 max-w-72 border-r border-foreground/10">
        {/* 搜索框 */}
        <div className="p-2 pb-1">
          <Textbox className="w-full" placeholder="Search..." value={search} onChange={setSearch} />
        </div>

        {/* 分类树 */}
        <div
          className="flex-1 overflow-y-auto px-1 text-[var(--fs-input)]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--background) 30%, transparent)' }}
        >
          {sortedCategories.filter((cat) => filteredTree[cat]).map((cat) => {
            const isExpanded = expandedCategories.has(cat);
            const items = filteredTree[cat] || [];
            return (
              <div key={cat}>
                {/* 一级：分类标题 */}
                <div
                  className="flex items-center gap-1 cursor-pointer py-1 px-1 hover:text-foreground/80 select-none"
                  onClick={() => toggleCategory(cat)}
                >
                  <span
                    className="inline-block transition-transform text-foreground/50"
                    style={{
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      fontSize: '8px',
                      width: '10px',
                      textAlign: 'center',
                    }}
                  >
                    ▶
                  </span>
                  <span className="font-medium">{cat}</span>
                  <span className="text-foreground/40 ml-auto">{items.length}</span>
                </div>

                {/* 二级：函数列表 */}
                {isExpanded && (
                  <div className="pl-4">
                    {items.map((entry) => (
                      <a
                        key={entry.name}
                        id={`ref-item-${entry.name}`}
                        className={`block cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis py-0.5 px-1 ${
                          entry.name === selectedFunction
                            ? 'font-bold bg-linehighlight'
                            : 'hover:text-foreground/70'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItemClick(entry.name);
                        }}
                      >
                        {entry.name}
                        {entry._synonyms && entry._synonyms.length > 0 && (
                          <small className="text-foreground/40 ml-1">({entry._synonyms.join(', ')})</small>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {!sortedCategories.filter((cat) => filteredTree[cat]).length && (
            <span className="text-foreground/30 italic px-2">No matches</span>
          )}
        </div>
      </div>

      {/* 右侧：详情面板 */}
      <div className="flex-1 flex-col overflow-y-auto min-w-0" id="reference-container">
        <div className="prose dark:prose-invert min-w-full px-3 py-2 text-foreground ref-content">
          {selectedEntry ? (
            <section>
              <h3>{selectedEntry.name}</h3>
              <p className="text-[var(--fs-hint)] text-foreground/40 mb-1">
                {selectedEntry._category}
              </p>
              {!!selectedEntry.synonyms_text && (
                <p>
                  Synonyms: <code>{selectedEntry.synonyms_text}</code>
                </p>
              )}
              <p dangerouslySetInnerHTML={{ __html: selectedEntry.description }}></p>
              {selectedEntry.params?.length > 0 && (
                <ul>
                  {selectedEntry.params.map(({ name, type, description }, j) => (
                    <li key={j}>
                      {name} : {type?.names?.join(' | ')} {description ? <> - {getInnerText(description)}</> : ''}
                    </li>
                  ))}
                </ul>
              )}
              {selectedEntry.examples?.map((example, j) => (
                <pre key={j}>{example}</pre>
              ))}
            </section>
          ) : (
            <p style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}>
              Select a function from the left panel.
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
