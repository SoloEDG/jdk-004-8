import type {
  DamageSource,
  Enemy,
  FrameEvents,
  GameDoc,
  StatusId,
  StatusMap,
  WeaponId,
} from "../../../shared/types";

/**
 * 元素状态配置：燃烧 / 冰缓 / 导电各自独立存在，不合并成一个伤害系数。
 * 每个状态实例都保留施加者、传播链（导电）与剩余时间，保证后续击杀不丢失来源。
 */
export const STATUS_CONFIG = {
  burn: {
    label: "燃烧",
    duration: 3,
    tickInterval: 0.5,
    /** 每跳伤害 = 直接命中伤害的 20%。 */
    tickRatio: 0.2,
    color: "#fb923c",
  },
  chill: {
    label: "冰缓",
    duration: 2.5,
    /** 移动速度与开火频率统一乘以 0.55。 */
    slowFactor: 0.55,
    color: "#7dd3fc",
  },
  shock: {
    label: "导电",
    duration: 3,
    pulseInterval: 0.9,
    /** 每次跳电伤害 = 施加时命中伤害的 45%。 */
    damageRatio: 0.45,
    radius: 150,
    maxJumps: 3,
    color: "#fde047",
  },
} as const;

/** 每把武器固定携带一种元素状态，三种武器因此可以自然组合。 */
export const WEAPON_STATUS: Record<WeaponId, StatusId> = {
  pulse: "shock",
  orbit: "burn",
  nova: "chill",
};

const EMPTY_SOURCES: Record<DamageSource, number> = {
  direct: 0,
  periodic: 0,
  chain: 0,
};

/** 统一的帧事件工厂，保证三类来源字段始终存在。 */
export function makeFrameEvents(): FrameEvents {
  return {
    kills: [],
    damage: 0,
    taken: 0,
    shots: 0,
    collected: 0,
    weaponDamage: {},
    bySource: { ...EMPTY_SOURCES },
  };
}

/**
 * 统一伤害漏斗：所有对敌人的扣血都必须经过这里。
 * 实际扣血以敌人剩余生命为上限，因此过量伤害天然不会入账；
 * 每笔实际伤害同时累计到对应来源分类，使三类贡献之和恒等于真实扣血。
 */
export function applyDamage(
  doc: GameDoc,
  enemy: Enemy,
  raw: number,
  source: DamageSource,
  weapon: WeaponId,
  events: FrameEvents,
): number {
  if (enemy.hp <= 0 || raw <= 0) return 0;
  const dealt = Math.min(enemy.hp, raw);
  enemy.hp -= dealt;
  events.damage += dealt;
  events.bySource[source] += dealt;
  events.weaponDamage![weapon] =
    (events.weaponDamage![weapon] || 0) + dealt;
  if (enemy.hp <= 0)
    events.kills.push({ enemy: { ...enemy }, weapon, source });
  return dealt;
}

/**
 * 施加或刷新元素状态。
 * 重复施加只刷新规定部分：
 *  - 燃烧：只刷新剩余时间与下一跳计时，施加者与每跳伤害保持首跳来源；
 *  - 冰缓：只刷新剩余时间，施加者与减速系数保留；
 *  - 导电：只刷新剩余时间，施加者、传播链、跳电参数与脉冲计时全部保留。
 */
export function applyStatus(
  statuses: StatusMap,
  id: StatusId,
  source: WeaponId,
  hitDamage: number,
): void {
  if (id === "burn") {
    const cfg = STATUS_CONFIG.burn;
    const existing = statuses.burn;
    if (existing) {
      existing.remaining = cfg.duration;
      existing.nextTickIn = cfg.tickInterval;
      return;
    }
    statuses.burn = {
      source,
      tickDamage: hitDamage * cfg.tickRatio,
      remaining: cfg.duration,
      nextTickIn: cfg.tickInterval,
      tickInterval: cfg.tickInterval,
    };
    return;
  }
  if (id === "chill") {
    const cfg = STATUS_CONFIG.chill;
    const existing = statuses.chill;
    if (existing) {
      existing.remaining = cfg.duration;
      return;
    }
    statuses.chill = {
      source,
      remaining: cfg.duration,
      slowFactor: cfg.slowFactor,
    };
    return;
  }
  const cfg = STATUS_CONFIG.shock;
  const existing = statuses.shock;
  if (existing) {
    existing.remaining = cfg.duration;
    return;
  }
  statuses.shock = {
    source,
    chain: [],
    damage: hitDamage * cfg.damageRatio,
    jumps: cfg.maxJumps,
    radius: cfg.radius,
    remaining: cfg.duration,
    pulseIn: cfg.pulseInterval,
    pulseInterval: cfg.pulseInterval,
  };
}

/** 冰缓移动速度系数（未被冰缓时为 1）。 */
export function chillMoveFactor(enemy: Enemy): number {
  return enemy.statuses.chill?.slowFactor ?? 1;
}

/** 冰缓开火冷却倍率：冷却变长等价于开火频率下降。 */
export function chillCooldownFactor(enemy: Enemy): number {
  const chill = enemy.statuses.chill;
  return chill ? 1 / chill.slowFactor : 1;
}

function nearestAliveWithin(
  doc: GameDoc,
  from: { x: number; y: number },
  radius: number,
  visited: Set<number>,
): Enemy | undefined {
  let best: Enemy | undefined;
  let bestSquared = radius * radius;
  for (const candidate of doc.enemies) {
    if (candidate.hp <= 0 || visited.has(candidate.id)) continue;
    const squared =
      (candidate.x - from.x) ** 2 + (candidate.y - from.y) ** 2;
    if (squared <= bestSquared) {
      best = candidate;
      bestSquared = squared;
    }
  }
  return best;
}

/**
 * 导电跳电：从一个带导电状态的敌人出发，按当时位置逐跳寻找最近存活目标。
 * visited 限制同一轮（同一次脉冲）内不得重复访问同一目标；
 * 找不到可传播目标时静默结束——失效传播不造成任何伤害，也不会入账。
 * 原目标即使在连锁中途死亡，也以它死亡瞬间的位置继续寻找下一跳。
 */
function runArc(
  doc: GameDoc,
  origin: Enemy,
  originState: NonNullable<StatusMap["shock"]>,
  events: FrameEvents,
): void {
  const visited = new Set<number>([origin.id]);
  let from: { x: number; y: number } = { x: origin.x, y: origin.y };
  // 滚动传播链：从起点已有的链出发，每经过一跳就把路径累积进去，
  // 保证后续目标看到的 chain 包含完整溯源路径（例如 [1,2,3]）。
  const path = [...originState.chain];
  for (let jump = 0; jump < originState.jumps; jump++) {
    const target = nearestAliveWithin(
      doc,
      from,
      originState.radius,
      visited,
    );
    if (!target) break; // 失效传播：无目标可跳，不产生任何记录
    visited.add(target.id);
    path.push(target.id);
    const chain = [...path];
    applyDamage(
      doc,
      target,
      originState.damage,
      "chain",
      originState.source,
      events,
    );
    doc.arcFx.push({
      id: doc.nextId++,
      x: from.x,
      y: from.y,
      toX: target.x,
      toY: target.y,
      life: 0.18,
    });
    if (target.hp > 0) {
      const existing = target.statuses.shock;
      if (existing) {
        // 已带导电：只刷新剩余时间，沿用原施加者与传播链，不覆盖来源。
        existing.remaining = STATUS_CONFIG.shock.duration;
      } else {
        target.statuses.shock = {
          source: originState.source,
          chain,
          damage: originState.damage,
          jumps: originState.jumps,
          radius: originState.radius,
          remaining: STATUS_CONFIG.shock.duration,
          pulseIn: originState.pulseInterval,
          pulseInterval: originState.pulseInterval,
        };
      }
    }
    from = { x: target.x, y: target.y };
  }
}

/**
 * 结算全部元素状态：衰减剩余时间、触发燃烧周期伤害与导电脉冲。
 * 升级/暂停阶段 simulate 会直接返回，因此这里的计时不会在暂停时流逝。
 */
export function stepStatuses(
  doc: GameDoc,
  events: FrameEvents,
  dt: number,
): void {
  for (const fx of doc.arcFx) fx.life -= dt;
  doc.arcFx = doc.arcFx.filter((fx) => fx.life > 0);

  for (const enemy of doc.enemies) {
    if (enemy.hp <= 0) continue;
    const statuses = enemy.statuses;

    const burn = statuses.burn;
    if (burn) {
      burn.remaining -= dt;
      burn.nextTickIn -= dt;
      if (burn.nextTickIn <= 0 && burn.remaining > 0) {
        // 周期伤害按施加者追溯，击杀进入正常掉落流程。
        applyDamage(
          doc,
          enemy,
          burn.tickDamage,
          "periodic",
          burn.source,
          events,
        );
        burn.nextTickIn += burn.tickInterval;
      }
      if (burn.remaining <= 0) delete statuses.burn;
    }

    const chill = statuses.chill;
    if (chill) {
      chill.remaining -= dt;
      if (chill.remaining <= 0) delete statuses.chill;
    }

    const shock = statuses.shock;
    if (shock) {
      shock.remaining -= dt;
      if (shock.remaining <= 0) {
        delete statuses.shock;
        continue;
      }
      shock.pulseIn -= dt;
    }
  }

  // 先快照本帧真正到期的脉冲源，再统一执行跳电：
  // 跳电新感染的导电不会进入本帧集合，因此最早也要等下一个脉冲才触发，
  // 避免连锁在同一帧内无限向外扩散。
  const pulses: { enemy: Enemy; shock: NonNullable<StatusMap["shock"]> }[] = [];
  for (const enemy of doc.enemies) {
    const shock = enemy.statuses.shock;
    if (enemy.hp > 0 && shock && shock.pulseIn <= 0) {
      shock.pulseIn += shock.pulseInterval;
      pulses.push({ enemy, shock });
    }
  }
  for (const { enemy, shock } of pulses) runArc(doc, enemy, shock, events);
  // 与直接命中一致，死亡敌人在结算后统一离场，掉落由击杀事件驱动。
  doc.enemies = doc.enemies.filter((enemy) => enemy.hp > 0);
}

/** 渲染与调试用：敌人当前携带的状态列表。 */
export function activeStatuses(enemy: Enemy): StatusId[] {
  const ids: StatusId[] = [];
  if (enemy.statuses.burn) ids.push("burn");
  if (enemy.statuses.chill) ids.push("chill");
  if (enemy.statuses.shock) ids.push("shock");
  return ids;
}
