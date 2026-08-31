(function exposeConfig(root, factory) {
  const config = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = config;
  }

  if (root) {
    root.GAME_CONFIG = config;
  }
})(typeof window !== "undefined" ? window : globalThis, function createConfig() {
  return Object.freeze({
    TICK_RATE: 60,
    SNAPSHOT_RATE: 15,
    WORLD_WIDTH: 2400,
    WORLD_HEIGHT: 2400,
    PLAYER_RADIUS: 18,
    PICKUP_RADIUS: 38,
    BASE_RADIUS: 72,
    BASE_MAX_HP: 2000,
    TEAM_LIMIT: 10,
    ROUND_RESET_MS: 8000,
    ATTACK_RANGE: 155,
    ATTACK_COST: 20,
    ATTACK_DAMAGE: 100,
    ATTACK_COOLDOWN: 2500,
    GLOBAL_SKILL_COOLDOWN: 1000,
    MAX_SPEED_BONUS: 0.35,
    MAX_SCORE_BONUS: 0.25,
    MAX_DAMAGE_REDUCTION: 0.25,
    TEAMS: {
      red: {
        name: "แดง",
        color: "#ef4444",
        spawn: { x: 170, y: 170 }
      },
      blue: {
        name: "น้ำเงิน",
        color: "#3b82f6",
        spawn: { x: 2230, y: 170 }
      },
      green: {
        name: "เขียว",
        color: "#22c55e",
        spawn: { x: 170, y: 2230 }
      },
      yellow: {
        name: "เหลือง",
        color: "#eab308",
        spawn: { x: 2230, y: 2230 }
      }
    },
    CLASSES: {
      warrior: {
        name: "นักรบ",
        role: "ผู้พิทักษ์",
        speed: 165,
        capacity: 14,
        activeCooldown: 20000,
        teamCooldown: 26000,
        activeCost: 10,
        teamCost: 14,
        description: "ป้องกันฐานและเพิ่มความแข็งแกร่งให้ทีม"
      },
      mage: {
        name: "นักเวท",
        role: "ผู้ควบคุมสัญลักษณ์",
        speed: 175,
        capacity: 13,
        activeCooldown: 18000,
        teamCooldown: 25000,
        activeCost: 8,
        teamCost: 12,
        description: "เปลี่ยนเครื่องหมายและตรวจหาเบี้ยสำคัญ"
      },
      runner: {
        name: "นักวิ่ง",
        role: "ผู้รวบรวม",
        speed: 210,
        capacity: 12,
        activeCooldown: 12000,
        teamCooldown: 22000,
        activeCost: 0,
        teamCost: 10,
        description: "เคลื่อนที่เร็วและสร้างเส้นทางให้เพื่อน"
      },
      engineer: {
        name: "นักประดิษฐ์",
        role: "ผู้สนับสนุน",
        speed: 170,
        capacity: 17,
        activeCooldown: 22000,
        teamCooldown: 15000,
        activeCost: 10,
        teamCost: 25,
        description: "ปรับสภาพเบี้ยและซ่อมฐาน"
      },
      mathematician: {
        name: "นักคณิตศาสตร์",
        role: "ผู้เชี่ยวชาญสมการ",
        speed: 180,
        capacity: 14,
        activeCooldown: 25000,
        teamCooldown: 28000,
        activeCost: 6,
        teamCost: 15,
        description: "ค้นหาคำใบ้และเพิ่มคะแนนสมการ"
      }
    },
    COSMETICS: {
      skin: ["skin-light", "skin-tan", "skin-brown", "skin-dark"],
      hair: ["hair-short", "hair-long", "hair-spiky", "hair-curly", "hair-none"],
      hairColor: ["#111827", "#713f12", "#f5d0a9", "#dc2626", "#7c3aed"],
      face: ["face-normal", "face-happy", "face-serious"],
      eyes: ["#111827", "#2563eb", "#16a34a", "#92400e"],
      shirt: ["shirt-basic", "shirt-armor", "shirt-robe", "shirt-jacket"],
      pants: ["pants-basic", "pants-short", "pants-robe"],
      shoes: ["shoes-basic", "shoes-boots", "shoes-runner"],
      hat: ["hat-none", "hat-cap", "hat-crown", "hat-wizard", "hat-helmet"],
      glasses: ["glasses-none", "glasses-round", "glasses-square"],
      back: ["back-none", "back-bag", "back-cape", "back-book"],
      effect: ["effect-none", "effect-stars", "effect-numbers", "effect-aura"],
      colors: [
        "#ef4444",
        "#3b82f6",
        "#22c55e",
        "#eab308",
        "#a855f7",
        "#ec4899",
        "#06b6d4",
        "#f97316",
        "#f8fafc",
        "#1f2937"
      ]
    },
    OBSTACLES: [
      { x: 520, y: 420, w: 260, h: 90 },
      { x: 1620, y: 420, w: 260, h: 90 },
      { x: 520, y: 1890, w: 260, h: 90 },
      { x: 1620, y: 1890, w: 260, h: 90 },
      { x: 1030, y: 780, w: 340, h: 80 },
      { x: 1030, y: 1540, w: 340, h: 80 },
      { x: 780, y: 1030, w: 80, h: 340 },
      { x: 1540, y: 1030, w: 80, h: 340 }
    ]
  });
});
