import type { GameDoc, Input } from "../shared/types";
import { stepCombat } from "../features/combat";
import { stepStatuses } from "../features/combat/model/statuses";
import { stepWaves } from "../features/waves";
import { stepArsenal } from "../features/arsenal";
import { stepProgression } from "../features/progression";
import { stepResults } from "../features/results";
export function simulate(doc: GameDoc, input: Input, dt: number) {
  if (doc.phase !== "playing") return;
  doc.time += dt;
  stepWaves(doc, dt);
  const shots = stepArsenal(doc, input, dt);
  const events = stepCombat(doc, input, dt);
  // 元素状态独立结算：燃烧周期伤害与导电跳电都在直接命中之后、掉落之前入账。
  stepStatuses(doc, events, dt);
  events.shots += shots;
  stepProgression(doc, events, dt);
  stepResults(doc, events);
}
