// SoundRegistry - 从 soundMap 动态同步音色信息
import { soundMap } from '@strudel/webaudio';

export class SoundRegistry {
  constructor() {
    this.sounds = new Map();
    this.lastUpdate = 0;
    this.updateInterval = 5000; // 5秒更新一次
  }

  sync() {
    const now = Date.now();
    if (now - this.lastUpdate < this.updateInterval) return;

    this.sounds.clear();
    const map = soundMap.get();

    for (const [name, entry] of Object.entries(map)) {
      if (name.startsWith('_')) continue;

      const { data } = entry;
      const info = {
        name,
        type: data.type,
        tag: data.tag || null,
        sampleCount: this._getSampleCount(data),
        category: this._categorize(name, data),
      };

      this.sounds.set(name, info);
    }

    this.lastUpdate = now;
  }

  _getSampleCount(data) {
    if (data.type === 'sample') {
      if (Array.isArray(data.samples)) return data.samples.length;
      if (data.samples && typeof data.samples === 'object') return Object.keys(data.samples).length;
    } else if (data.type === 'soundfont') {
      return data.fonts?.length || 0;
    }
    return 0;
  }

  _categorize(name, data) {
    // 数据驱动：若音色注册时声明了 category，直接采用，避免硬编码名单
    if (data.category) return data.category;
    if (data.type === 'synth') return 'Synths';
    if (data.type === 'soundfont') return 'GM Soundfonts';
    if (data.tag === 'drum-machines') return 'Drum Machines';
    // 特殊采样
    if (['piano', 'casio', 'jazz', 'metal', 'east', 'crow', 'insect', 'wind', 'foot', 'fx', 'birds', 'amen', 'tabla'].includes(name)) {
      return 'Special Samples';
    }
    return 'Samples';
  }

  query(filter) {
    this.sync();
    let results = Array.from(this.sounds.values());

    if (filter?.category) {
      results = results.filter((s) => s.category === filter.category);
    }
    if (filter?.type) {
      results = results.filter((s) => s.type === filter.type);
    }
    if (filter?.tag) {
      results = results.filter((s) => s.tag === filter.tag);
    }
    if (filter?.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (s) => s.name.toLowerCase().includes(search) || s.category.toLowerCase().includes(search),
      );
    }

    return results;
  }

  getSound(name) {
    this.sync();
    return this.sounds.get(name) || this.sounds.get(name.toLowerCase());
  }

  getCategories() {
    this.sync();
    const categories = new Set();
    for (const sound of this.sounds.values()) {
      categories.add(sound.category);
    }
    return Array.from(categories).sort();
  }

  // 生成音色列表摘要（用于 System Prompt 动态注入）
  // 策略：每类只列前若干个 + 总数 + 提示用 list_sounds 查询更多，
  // 避免大类（如 Samples 上百个）铺满 prompt 又让模型误以为"只有这些"。
  generateSummary() {
    this.sync();

    const byCategory = new Map();
    for (const sound of this.sounds.values()) {
      if (!byCategory.has(sound.category)) {
        byCategory.set(sound.category, []);
      }
      byCategory.get(sound.category).push(sound);
    }

    let summary = '';

    for (const [category, sounds] of byCategory) {
      summary += `### ${category} (${sounds.length})\n`;
      const display = sounds.slice(0, 15);
      const names = display
        .map((s) => {
          let desc = `\`${s.name}\``;
          if (s.sampleCount && s.sampleCount > 1) {
            desc += `(${s.sampleCount})`;
          }
          return desc;
        })
        .join(', ');
      summary += names;
      if (sounds.length > 15) {
        summary += `\n... and ${sounds.length - 15} more — use list_sounds to search or filter this category.`;
      }
      summary += '\n\n';
    }

    return summary;
  }
}

// 单例
export const soundRegistry = new SoundRegistry();
