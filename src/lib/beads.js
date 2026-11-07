/**
 * 原型自带的珠子图片和示例手串。
 * 珠子图片来自 dushe 小程序 apps/miniapp/assets/beads（128×128 透明底，穿线孔水平）。
 * 示例手串的珠序来自 dushe utils/design.js 里的 COOL / WARM / DARK 三套默认配色。
 */

const NAMES = {
  amazonite: '天河石',
  amethyst: '紫水晶',
  aqua: '海蓝宝',
  'black-tourmaline': '黑碧玺',
  citrine: '黄水晶',
  clear: '白水晶',
  fluorite: '萤石',
  garnet: '石榴石',
  jade: '玉髓',
  kyanite: '蓝晶石',
  labradorite: '拉长石',
  lapis: '青金石',
  moon: '月光石',
  morganite: '摩根石',
  obsidian: '黑曜石',
  pearl: '珍珠',
  prehnite: '葡萄石',
  'red-agate': '红玛瑙',
  rose: '粉晶',
  silver: '银珠',
  smoky: '茶晶',
  strawberry: '草莓晶',
  sunstone: '太阳石',
  'tiger-eye': '虎眼石',
};

function imagePath(key) {
  return '/assets/beads/' + key + '.png';
}

function seq(list) {
  return list.map((id) => {
    const m = /^(.*)-(\d+)$/.exec(id);
    return { key: m[1], sizeMm: Number(m[2]) };
  });
}

const SAMPLES = [
  {
    id: 'tiger14',
    title: '虎眼石 14mm',
    note: '男款 · 全虎眼石 14mm',
    wristCm: 17, // 男生常见手围
    // 珠子数量会按手围自动补齐：17cm 手围约 13 颗
    beads: seq(['tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14', 'tiger-eye-14']),
  },
  {
    id: 'cool',
    title: '清透月光',
    note: '月光石 · 海蓝宝 · 白水晶',
    beads: seq([
      'moon-10', 'silver-6', 'aqua-8', 'clear-8', 'amazonite-8', 'prehnite-8', 'moon-8', 'fluorite-8', 'kyanite-8',
      'silver-6', 'clear-10', 'aqua-8', 'amazonite-8', 'prehnite-8', 'moon-8', 'fluorite-8', 'kyanite-8', 'clear-8', 'aqua-8',
    ]),
  },
  {
    id: 'warm',
    title: '温柔粉调',
    note: '粉晶 · 摩根石 · 草莓晶',
    beads: seq([
      'rose-10', 'morganite-8', 'strawberry-8', 'citrine-8', 'silver-6', 'rose-8', 'sunstone-8', 'red-agate-8', 'morganite-8',
      'rose-12', 'strawberry-8', 'citrine-10', 'silver-6', 'rose-8', 'sunstone-8', 'red-agate-8', 'morganite-8', 'clear-8',
    ]),
  },
  {
    id: 'dark',
    title: '深夜茶晶',
    note: '茶晶 · 拉长石 · 黑曜石',
    beads: seq([
      'smoky-10', 'labradorite-8', 'obsidian-8', 'black-tourmaline-8', 'silver-6', 'smoky-8', 'garnet-8', 'tiger-eye-8',
      'labradorite-8', 'smoky-12', 'obsidian-8', 'black-tourmaline-8', 'silver-6', 'garnet-8', 'tiger-eye-8', 'smoky-8',
      'labradorite-8', 'garnet-8',
    ]),
  },
  {
    id: 'pearl',
    title: '珍珠白',
    note: '珍珠 · 白水晶 · 银珠',
    beads: seq(['pearl-8', 'clear-8', 'pearl-8', 'silver-6', 'pearl-8', 'clear-8', 'pearl-8', 'moon-10', 'pearl-8', 'clear-8', 'silver-6']),
  },
  {
    id: 'men',
    title: '男款虎眼',
    note: '虎眼石 · 黑曜石 12mm',
    wristCm: 17,
    beads: seq(['tiger-eye-14', 'obsidian-12', 'tiger-eye-12', 'obsidian-12', 'lapis-12', 'obsidian-12', 'tiger-eye-12', 'obsidian-12']),
  },
];

module.exports = { NAMES, SAMPLES, imagePath };
