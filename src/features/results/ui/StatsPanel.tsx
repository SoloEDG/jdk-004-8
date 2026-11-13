import type { GameDoc, DamageSource } from "../../../shared/types";
const SOURCE_LABEL: Record<DamageSource, string> = {
  direct: "直接命中",
  periodic: "持续伤害",
  chain: "连锁跳电",
};
export function StatsPanel({ doc }: { doc: GameDoc }) {
  return (
    <section className="panel stats">
      <div className="section-caption">
        <span>本局遥测</span>
        <span className="status-dot" />
      </div>
      <div className="stat-row">
        <span>击败敌人</span>
        <strong className="mono">
          {doc.stats.kills.toString().padStart(3, "0")}
        </strong>
      </div>
      <div className="stat-row">
        <span>累计伤害</span>
        <strong className="mono">
          {Math.round(doc.stats.damage).toLocaleString()}
        </strong>
      </div>
      {(["direct", "periodic", "chain"] as DamageSource[]).map((key) => (
        <div className="stat-row sub" key={key}>
          <span>{SOURCE_LABEL[key]}</span>
          <strong className="mono">{Math.round(doc.stats.bySource[key])}</strong>
        </div>
      ))}
      <div className="stat-row">
        <span>拾取能量</span>
        <strong className="mono">{doc.stats.collected}</strong>
      </div>
      <div className="stat-row">
        <span>已受伤害</span>
        <strong className="mono">{Math.round(doc.stats.taken)}</strong>
      </div>
    </section>
  );
}
