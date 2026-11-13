export type Vec = { x: number; y: number };
export type Phase = "ready" | "playing" | "paused" | "upgrade" | "ended";
export type WeaponId = "pulse" | "orbit" | "nova";
/** 可组合的元素状态：燃烧 / 冰缓 / 导电，三者互不排斥，各自独立记账。 */
export type StatusId = "burn" | "chill" | "shock";
/** 伤害来源分类：直接命中 / 持续伤害（燃烧周期伤害）/ 连锁（导电跳电）。 */
export type DamageSource = "direct" | "periodic" | "chain";
/** 燃烧：施加者与每跳伤害在刷新时保留，只有剩余时间与下一跳计时允许被刷新。 */
export interface BurnState {
  source: WeaponId;
  tickDamage: number;
  remaining: number;
  nextTickIn: number;
  tickInterval: number;
}
/** 冰缓：独立保留施加者、减速系数与剩余时间，影响移动与开火频率。 */
export interface ChillState {
  source: WeaponId;
  remaining: number;
  slowFactor: number;
}
/** 导电：保留施加者、完整传播链与跳电参数，按脉冲向邻近目标跳电。 */
export interface ShockState {
  source: WeaponId;
  chain: number[];
  damage: number;
  jumps: number;
  radius: number;
  remaining: number;
  pulseIn: number;
  pulseInterval: number;
}
export interface StatusMap {
  burn?: BurnState;
  chill?: ChillState;
  shock?: ShockState;
}
export interface Player extends Vec {
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  invincible: number;
}
export interface Enemy extends Vec {
  id: number;
  kind: "chaser" | "shooter" | "elite";
  hp: number;
  maxHp: number;
  radius: number;
  cooldown: number;
  statuses: StatusMap;
}
export interface Bullet extends Vec {
  id: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  owner: "player" | "enemy";
  weapon: WeaponId | "enemy";
  pierce: number;
  hit: number[];
  /** 发射该弹的武器附加的元素状态，命中时施加给敌人。 */
  status?: StatusId;
}
/** 跳电电弧的瞬时渲染特效，由导电脉冲产生并按 life 衰减。 */
export interface ArcFx extends Vec {
  id: number;
  toX: number;
  toY: number;
  life: number;
}
export interface Drop extends Vec {
  id: number;
  kind: "xp" | "heal" | "magnet";
  value: number;
  life: number;
}
export interface Weapon {
  id: WeaponId;
  level: number;
  cooldown: number;
}
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  category: string;
  max: number;
}
export interface RunStats {
  kills: number;
  damage: number;
  taken: number;
  collected: number;
  shots: number;
  byWeapon: Record<WeaponId, number>;
  /** 三类来源贡献，三者之和恒等于累计实际扣血（过量与失效传播不入账）。 */
  bySource: Record<DamageSource, number>;
}
export interface RunRecord {
  id: string;
  duration: number;
  wave: number;
  level: number;
  kills: number;
  damage: number;
  weapons: string[];
  victory: boolean;
}
export interface GameDoc {
  version: 1;
  seed: number;
  initialSeed: number;
  nextId: number;
  phase: Phase;
  time: number;
  player: Player;
  enemies: Enemy[];
  bullets: Bullet[];
  drops: Drop[];
  arcFx: ArcFx[];
  weapons: Weapon[];
  upgrades: Record<string, number>;
  choices: string[];
  xp: number;
  level: number;
  pendingLevels: number;
  wave: number;
  waveTime: number;
  spawnBudget: number;
  stats: RunStats;
  records: RunRecord[];
  notice: string;
  victory: boolean;
}
export interface Input {
  x: number;
  y: number;
  aim: Vec;
  firing: boolean;
}
export interface KillEvent {
  enemy: Enemy;
  weapon: WeaponId;
  /** 致命一击的来源分类，保证燃烧与跳电击杀仍能追溯施加者并进入正常掉落。 */
  source: DamageSource;
}
export interface FrameEvents {
  weaponDamage?: Partial<Record<WeaponId, number>>;
  bySource: Record<DamageSource, number>;
  kills: KillEvent[];
  damage: number;
  taken: number;
  shots: number;
  collected: number;
}
export const WIDTH = 1000;
export const HEIGHT = 650;
