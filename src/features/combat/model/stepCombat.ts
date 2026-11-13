import type { GameDoc, Input, WeaponId } from "../../../shared/types";
import { WIDTH, HEIGHT } from "../../../shared/types";
import { clamp, distance, normalize } from "../../../shared/math";
import { segmentDistance } from "../lib/collision";
import { hurtPlayer } from "./health";
import { applyDamage, applyStatus, makeFrameEvents } from "./statuses";
export function stepCombat(
  doc: GameDoc,
  input: Input,
  dt: number,
) {
  const events = makeFrameEvents();
  const player = doc.player;
  player.invincible = Math.max(0, player.invincible - dt);
  const direction = normalize(input.x, input.y),
    strength = Math.min(1, Math.hypot(input.x, input.y));
  player.x = clamp(
    player.x + direction.x * strength * player.speed * dt,
    player.radius,
    WIDTH - player.radius,
  );
  player.y = clamp(
    player.y + direction.y * strength * player.speed * dt,
    player.radius,
    HEIGHT - player.radius,
  );
  for (const bullet of doc.bullets) {
    const previous = { x: bullet.x, y: bullet.y };
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    if (bullet.life < 0) continue;
    if (bullet.owner === "enemy") {
      if (
        segmentDistance(player, previous, bullet) <
        player.radius + bullet.radius
      ) {
        events.taken += hurtPlayer(doc, bullet.damage);
        bullet.life = -1;
      }
      continue;
    }
    for (const enemy of doc.enemies) {
      if (enemy.hp <= 0 || bullet.hit.includes(enemy.id)) continue;
      if (
        segmentDistance(enemy, previous, bullet) >
        enemy.radius + bullet.radius
      )
        continue;
      bullet.hit.push(enemy.id);
      const weapon: WeaponId = bullet.weapon as WeaponId;
      // 直接命中通过统一漏斗扣血，过量伤害不会计入任何来源。
      applyDamage(
        doc,
        enemy,
        bullet.damage,
        "direct",
        weapon,
        events,
      );
      // 命中即施加武器元素状态；状态独立保留施加者与剩余时间，可与已有状态叠加。
      if (bullet.status) applyStatus(enemy.statuses, bullet.status, weapon, bullet.damage);
      if (bullet.pierce <= 0) {
        bullet.life = -1;
        break;
      }
      bullet.pierce--;
    }
  }
  for (const enemy of doc.enemies) {
    if (enemy.hp > 0 && distance(enemy, player) < enemy.radius + player.radius)
      events.taken += hurtPlayer(doc, enemy.kind === "elite" ? 25 : 12);
  }
  doc.enemies = doc.enemies.filter((e) => e.hp > 0);
  doc.bullets = doc.bullets.filter(
    (b) =>
      b.life >= 0 &&
      b.x > -120 &&
      b.x < WIDTH + 120 &&
      b.y > -120 &&
      b.y < HEIGHT + 120,
  );
  return events;
}
