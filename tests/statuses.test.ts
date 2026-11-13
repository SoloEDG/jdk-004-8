import { test } from "node:test";
import assert from "node:assert/strict";
import { createRun } from "../src/shared/createRun";
import { stepCombat } from "../src/features/combat";
import {
  STATUS_CONFIG,
  WEAPON_STATUS,
  applyStatus,
  makeFrameEvents,
  stepStatuses,
} from "../src/features/combat/model/statuses";
import { generateDrops } from "../src/features/progression/lib/drops";
import { applyEvents } from "../src/features/results/model/ledger";
import { stepWaves } from "../src/features/waves";
import { simulate } from "../src/app/simulate";
import type { Enemy, FrameEvents } from "../src/shared/types";

const input = { x: 0, y: 0, aim: { x: 700, y: 325 }, firing: false };

function makeEnemy(
  id: number,
  x = 600,
  y = 325,
  hp = 100,
  kind: Enemy["kind"] = "chaser",
): Enemy {
  return {
    id,
    kind,
    x,
    y,
    hp,
    maxHp: hp,
    radius: 12,
    cooldown: 0,
    statuses: {},
  };
}

function bulletAt(x: number, y: number, weapon: "pulse" | "orbit" | "nova", damage = 20, status = WEAPON_STATUS[weapon]) {
  return {
    id: 500 + Math.trunc(x),
    x,
    y,
    vx: 0,
    vy: 0,
    radius: 5,
    damage,
    life: 1,
    owner: "player" as const,
    weapon,
    pierce: 0,
    hit: [],
    status,
  };
}

test("命中施加与武器绑定的元素状态，三种状态可同时共存于同一敌人", () => {
  const d = createRun();
  const e = makeEnemy(1);
  d.enemies = [e];
  d.bullets = [bulletAt(e.x, e.y, "pulse")];
  stepCombat(d, input, 0);
  assert.ok(e.statuses.shock, "脉冲应附加导电");

  d.bullets = [bulletAt(e.x, e.y, "orbit", 20, WEAPON_STATUS.orbit)];
  stepCombat(d, input, 0);
  d.bullets = [bulletAt(e.x, e.y, "nova", 20, WEAPON_STATUS.nova)];
  stepCombat(d, input, 0);
  assert.ok(e.statuses.burn && e.statuses.chill && e.statuses.shock);
});

test("燃烧按周期造成持续伤害并按施加者追溯，击杀进入正常掉落", () => {
  const d = createRun();
  const e = makeEnemy(1, 600, 325, 8);
  d.enemies = [e];
  applyStatus(e.statuses, "burn", "orbit", 20);
  const tick = e.statuses.burn!.tickDamage;
  assert.ok(tick > 0);
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.burn.tickInterval);
  assert.equal(events.bySource.periodic, tick);
  assert.equal(events.damage, tick);
  assert.equal(events.kills.length, 0);

  // 再跑若干跳直到烧死
  let guard = 0;
  while (e.hp > 0 && guard++ < 20) stepStatuses(d, events, STATUS_CONFIG.burn.tickInterval);
  const kill = events.kills.at(-1)!;
  assert.equal(kill.source, "periodic");
  assert.equal(kill.weapon, "orbit");

  const dropsBefore = d.drops.length;
  generateDrops(d, events);
  assert.ok(d.drops.length > dropsBefore, "持续伤害击杀必须产生掉落");
});

test("重复施加燃烧只刷新时间，保留首次施加者与每跳伤害", () => {
  const e = makeEnemy(1);
  applyStatus(e.statuses, "burn", "orbit", 100);
  const first = e.statuses.burn!;
  const originalTick = first.tickDamage;
  first.remaining = 0.4;
  // 用另一把武器、另一个命中伤害重复施加
  applyStatus(e.statuses, "burn", "nova", 10);
  assert.equal(e.statuses.burn!.tickDamage, originalTick, "每跳伤害不被覆盖");
  assert.equal(e.statuses.burn!.source, "orbit", "施加者不被覆盖");
  assert.equal(
    e.statuses.burn!.remaining,
    STATUS_CONFIG.burn.duration,
    "只刷新剩余时间",
  );
});

test("冰缓降低移动速度并延长开火冷却，时长结束后恢复", () => {
  const d = createRun();
  d.wave = 1;
  // chaser 的 standOff 恒为 1，两个敌人速度路径一致，只差冰缓系数
  const chilled = makeEnemy(1, 600, 325, 100, "chaser");
  const normal = makeEnemy(2, 600, 350, 100, "chaser");
  d.player.x = 0;
  d.player.y = 325;
  d.enemies = [chilled, normal];
  applyStatus(chilled.statuses, "chill", "nova", 20);
  const slow = chilled.statuses.chill!.slowFactor;
  stepWaves(d, 0.1);
  const chilledMove = Math.abs(600 - chilled.x);
  const normalMove = Math.abs(600 - normal.x);
  assert.ok(chilledMove > 0);
  assert.ok(
    Math.abs(chilledMove / normalMove - slow) < 1e-3,
    "冰缓敌人的位移应等于正常位移乘减速系数",
  );
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.chill.duration + 0.01);
  assert.equal(chilled.statuses.chill, undefined, "冰缓到期移除");
});

test("导电脉冲向最近存活目标跳电，同一轮不重复访问，且新感染不同帧扩散", () => {
  const d = createRun();
  const origin = makeEnemy(1, 400, 325, 1000);
  const near = makeEnemy(2, 480, 325, 1000);
  const far = makeEnemy(3, 560, 325, 1000);
  d.enemies = [origin, near, far];
  applyStatus(origin.statuses, "shock", "pulse", 100);
  const arcDamage = origin.statuses.shock!.damage;
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.shock.pulseInterval);

  assert.equal(events.bySource.chain, arcDamage * 2, "两跳各造成一次连锁伤害");
  assert.ok(near.statuses.shock && far.statuses.shock, "跳电传播导电状态");
  assert.deepEqual(
    near.statuses.shock!.chain,
    [2],
    "第一跳记录被访问目标的链序列",
  );
  assert.deepEqual(
    far.statuses.shock!.chain,
    [2, 3],
    "后续跳在扁平传播链上继续追加路径",
  );
  assert.ok(d.arcFx.length >= 2, "产生电弧特效");
  // 同一轮内 origin 不会被反向重复命中，且新感染者本帧不再向外脉冲
  assert.equal(origin.hp, 1000, "跳电起点不被自己的电弧伤害");
  assert.equal(events.bySource.chain, arcDamage * 2);
});

test("原目标在连锁中途死亡时，按死亡瞬间位置继续寻找下一跳", () => {
  const d = createRun();
  // 第一跳目标只有 1 血，会在连锁中途死亡，后续跳以它的位置为起点
  const origin = makeEnemy(1, 400, 325, 1000);
  const doomed = makeEnemy(2, 480, 325, 1);
  const beyond = makeEnemy(3, 560, 325, 1000);
  d.enemies = [origin, doomed, beyond];
  applyStatus(origin.statuses, "shock", "pulse", 100);
  const arcDamage = origin.statuses.shock!.damage;
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.shock.pulseInterval);
  const chainKill = events.kills.find((k) => k.enemy.id === 2);
  assert.ok(chainKill, "中途目标被跳电击杀");
  assert.equal(chainKill!.source, "chain");
  assert.equal(chainKill!.weapon, "pulse");
  // 即使 doomed 已死，beyond 仍以 doomed 当时位置为锚点被命中（吃到完整一跳）
  assert.equal(beyond.hp, 1000 - arcDamage);
  // doomed 实际只扣 1 点（过量的 44 不入账），beyond 扣完整一跳
  assert.equal(events.bySource.chain, 1 + arcDamage);
});

test("失效传播（范围内无目标）不产生任何伤害或入账", () => {
  const d = createRun();
  const origin = makeEnemy(1, 100, 100, 1000);
  const lonely = makeEnemy(2, 900, 600, 1000);
  d.enemies = [origin, lonely];
  applyStatus(origin.statuses, "shock", "pulse", 100);
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.shock.pulseInterval);
  assert.equal(events.bySource.chain, 0);
  assert.equal(events.kills.length, 0);
  assert.equal(lonely.hp, 1000);
});

test("导电重复施加只刷新剩余时间，保留原传播链与施加者", () => {
  const e = makeEnemy(2);
  applyStatus(e.statuses, "shock", "pulse", 100);
  e.statuses.shock!.chain = [1, 2];
  e.statuses.shock!.remaining = 0.3;
  applyStatus(e.statuses, "shock", "nova", 50);
  assert.equal(e.statuses.shock!.source, "pulse");
  assert.deepEqual(e.statuses.shock!.chain, [1, 2]);
  assert.equal(e.statuses.shock!.remaining, STATUS_CONFIG.shock.duration);
});

test("过量伤害只按实际扣血入账，三类来源之和恒等于真实扣血", () => {
  const d = createRun();
  const e = makeEnemy(1, 600, 325, 5);
  d.enemies = [e];
  d.bullets = [bulletAt(e.x, e.y, "pulse", 9999)];
  const events = stepCombat(d, input, 0);
  assert.equal(events.damage, 5, "过量的 9994 点伤害不入账");
  assert.equal(events.bySource.direct, 5);
  assert.equal(events.kills.length, 1);
  const sum =
    events.bySource.direct + events.bySource.periodic + events.bySource.chain;
  assert.equal(sum, events.damage);
});

test("连锁击杀可追溯到最初施加武器，并与直接击杀一样掉落", () => {
  const d = createRun();
  const origin = makeEnemy(1, 400, 325, 1000);
  const victim = makeEnemy(2, 480, 325, 1);
  d.enemies = [origin, victim];
  applyStatus(origin.statuses, "shock", "pulse", 100);
  const events = makeFrameEvents();
  stepStatuses(d, events, STATUS_CONFIG.shock.pulseInterval);
  const kill = events.kills.find((k) => k.enemy.id === 2)!;
  assert.equal(kill.source, "chain");
  assert.equal(kill.weapon, "pulse", "连锁击杀追溯到脉冲施加者");
  const before = d.drops.length;
  generateDrops(d, events);
  assert.ok(d.drops.length > before);
});

test("升级/暂停期间状态剩余时间不流逝", () => {
  const d = createRun();
  d.phase = "paused";
  const e = makeEnemy(1);
  d.enemies = [e];
  applyStatus(e.statuses, "burn", "orbit", 20);
  applyStatus(e.statuses, "chill", "nova", 20);
  const burnRemaining = e.statuses.burn!.remaining;
  const chillRemaining = e.statuses.chill!.remaining;
  // simulate 在非 playing 阶段直接返回
  for (let i = 0; i < 10; i++)
    simulate(d, { ...input, firing: true }, 1 / 60);
  assert.equal(e.statuses.burn!.remaining, burnRemaining);
  assert.equal(e.statuses.chill!.remaining, chillRemaining);
});

test("账本汇总后三类贡献之和等于累计实际扣血", () => {
  const d = createRun();
  d.phase = "playing";
  const a = makeEnemy(1, 600, 325, 30);
  const b = makeEnemy(2, 620, 325, 100);
  d.enemies = [a, b];
  d.bullets = [bulletAt(a.x, a.y, "pulse", 20)];
  const direct = stepCombat(d, input, 0);
  applyStatus(b.statuses, "burn", "orbit", 100);
  const periodic = makeFrameEvents();
  stepStatuses(d, periodic, STATUS_CONFIG.burn.tickInterval);

  const merged: FrameEvents = {
    ...makeFrameEvents(),
    damage: direct.damage + periodic.damage,
    kills: [...direct.kills, ...periodic.kills],
    bySource: {
      direct: direct.bySource.direct + periodic.bySource.direct,
      periodic: direct.bySource.periodic + periodic.bySource.periodic,
      chain: direct.bySource.chain + periodic.bySource.chain,
    },
  };
  applyEvents(d, merged);
  const sum =
    d.stats.bySource.direct +
    d.stats.bySource.periodic +
    d.stats.bySource.chain;
  assert.equal(Math.round(sum * 1000), Math.round(d.stats.damage * 1000));
});
