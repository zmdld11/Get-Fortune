// tarot.ts — 塔罗(78张,韦特传统牌意关键词) + 卢恩符文(24老弗萨克)
// 依据 fortune-calc skill references/yijing.md §4 / misc-systems.md §6。
// 随机源: crypto.getRandomValues。牌意仅关键词表,解读禁"宇宙想让你知道"体。

export interface TarotCard { id: number; name: string; en: string; keywords: string[]; reversedHint: string }

const MAJOR: [string, string, string[]][] = [
  ["愚者", "The Fool", ["新开始", "天真", "冒险", "不确定性"]],
  ["魔术师", "The Magician", ["行动力", "资源齐备", "沟通", "意愿落地"]],
  ["女祭司", "The High Priestess", ["直觉", "内在知识", "静观", "未显化"]],
  ["女皇", "The Empress", ["丰饶", "滋养", "感官", "创造"]],
  ["皇帝", "The Emperor", ["秩序", "权威", "结构", "掌控"]],
  ["教皇", "The Hierophant", ["传统", "体制", "指导", "信仰"]],
  ["恋人", "The Lovers", ["选择", "结合", "价值观对齐", "关系"]],
  ["战车", "The Chariot", ["意志", "推进", "自律", "胜利欲"]],
  ["力量", "Strength", ["柔韧", "驯服本能", "耐心", "内在力量"]],
  ["隐士", "The Hermit", ["内省", "独处", "寻找答案", "指引"]],
  ["命运之轮", "Wheel of Fortune", ["周期", "转折点", "运势流动", "因果"]],
  ["正义", "Justice", ["因果", "权衡", "责任", "清算"]],
  ["倒吊人", "The Hanged Man", ["悬置", "换视角", "放下控制", "等待"]],
  ["死神", "Death", ["结束与重生", "放手", "阶段更替", "转化"]],
  ["节制", "Temperance", ["调和", "中道", "耐心融合", "平衡"]],
  ["恶魔", "The Devil", ["执着", "欲望绑定", "成瘾模式", "物质束缚"]],
  ["高塔", "The Tower", ["骤变", "结构崩塌", "假象破灭", "冲击后的重建"]],
  ["星星", "The Star", ["希望", "疗愈", "长期信心", "灵感"]],
  ["月亮", "The Moon", ["迷雾", "潜意识", "不安", "暧昧不明"]],
  ["太阳", "The Sun", ["明朗", "活力", "成功外显", "坦率"]],
  ["审判", "Judgement", ["召唤", "复盘觉醒", "重大决定", "重生"]],
  ["世界", "The World", ["完成", "整合", "里程碑", "圆满"]],
];

const SUITS: [string, string, string, string[]][] = [
  ["权杖", "Wands", "火", ["行动", "热情", "事业", "开创"]],
  ["圣杯", "Cups", "水", ["情感", "关系", "直觉", "滋养"]],
  ["宝剑", "Swords", "风", ["思维", "沟通", "冲突", "决断"]],
  ["星币", "Pentacles", "土", ["物质", "身体", "金钱", "务实"]],
];

const RANKS: [string, string, string[]][] = [
  ["Ace", "首牌", ["开端", "纯粹潜能"]],
  ["2", "二", ["权衡", "初始组合"]],
  ["3", "三", ["展开", "初步成果"]],
  ["4", "四", ["稳定", "停驻"]],
  ["5", "五", ["冲突", "失衡"]],
  ["6", "六", ["过渡", "互助"]],
  ["7", "七", ["评估", "坚持或放手"]],
  ["8", "八", ["推进", "熟练度"]],
  ["9", "九", ["接近完成", "内省守成"]],
  ["10", "十", ["段落收束", "承载结果"]],
  ["Page", "侍从", ["学习", "消息", "初生能量"]],
  ["Knight", "骑士", ["追求", "行动方式", "推进中的能量"]],
  ["Queen", "王后", ["内在掌控", "滋养面"]],
  ["King", "国王", ["外在掌控", "成熟主导"]],
];

function buildDeck(): TarotCard[] {
  const deck: TarotCard[] = [];
  MAJOR.forEach(([name, en, kw], i) => {
    deck.push({ id: i, name: i > 0 ? `${name}(${i})` : name, en, keywords: kw, reversedHint: "逆位=受阻内化/过度或不足" });
  });
  let id = 22;
  for (const [cn, en, elem, suitKw] of SUITS) {
    void elem;
    for (const [rankEn, rankCn, rankKw] of RANKS) {
      const name = rankEn === "Ace" ? `${cn}Ace` : `${cn}${rankCn}`;
      deck.push({
        id: id++,
        name,
        en: `${rankEn} of ${en}`,
        keywords: [...suitKw.slice(0, 2), ...rankKw],
        reversedHint: "逆位=受阻内化/过度或不足",
      });
    }
  }
  return deck;
}

export const TAROT_DECK = buildDeck();
export const CELTIC_CROSS = ["现状", "阻碍", "根基", "过去", "显面", "未来", "自我", "环境", "希望恐惧", "结局"];
export const THREE_SPREAD = ["过去", "现在", "走向"];

function randInt(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

export interface DrawnCard { card: TarotCard; reversed: boolean; position: string }

/** 抽牌: spread = "celtic" | "three" | "single" */
export function drawTarot(spread: string): DrawnCard[] {
  const positions = spread === "celtic" ? CELTIC_CROSS : spread === "three" ? THREE_SPREAD : ["指引"];
  const picked = new Set<number>();
  return positions.map((position) => {
    let i = randInt(TAROT_DECK.length);
    while (picked.has(i)) i = randInt(TAROT_DECK.length);
    picked.add(i);
    return { card: TAROT_DECK[i], reversed: randInt(2) === 1, position };
  });
}

// ---------------- 卢恩符文(24老弗萨克) ----------------

const RUNES: [string, string][] = [
  ["Fehu", "财富/流动资源"], ["Uruz", "原始力量/生命力"], ["Thurisaz", "刺/防御性冲击"],
  ["Ansuz", "言语/讯息/神启"], ["Raidho", "旅程/有序移动"], ["Kenaz", "火光/技艺/洞见"],
  ["Gebo", "馈赠/交换/平衡"], ["Wunjo", "喜悦/和谐"], ["Hagalaz", "冰雹/不可控破坏"],
  ["Nauthiz", "匮乏/必要约束"], ["Isa", "冰/停滞"], ["Jera", "收获/周期兑现"],
  ["Eihwaz", "紫杉/韧性与转化"], ["Perthro", "命运之骰/隐秘"], ["Algiz", "保护/更高的助力"],
  ["Sowilo", "太阳/成功能量"], ["Tiwaz", "胜利/正义秩序"], ["Berkana", "白桦/新生成长"],
  ["Ehwaz", "马/协作前进"], ["Mannaz", "人/自我与人际"], ["Laguz", "水/流动直觉"],
  ["Ingwaz", "丰饶/积蓄完成"], ["Dagaz", "破晓/突破转机"], ["Othala", "祖产/根基传承"],
];

export interface DrawnRune { name: string; meaning: string; reversed: boolean; position: string }

/** 三张抽法(过去/现在/走向); 逆位=受阻内化 */
export function drawRunes(): DrawnRune[] {
  const picked = new Set<number>();
  return THREE_SPREAD.map((position) => {
    let i = randInt(RUNES.length);
    while (picked.has(i)) i = randInt(RUNES.length);
    picked.add(i);
    const [name, meaning] = RUNES[i];
    return { name, meaning, reversed: randInt(2) === 1, position };
  });
}
