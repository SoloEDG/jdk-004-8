import type { GameDoc, DamageSource } from "../../../shared/types";
import { formatTime } from "../../../shared/math";
const SOURCE_LABEL: Record<DamageSource, string> = {
  direct: "直接命中",
  periodic: "持续伤害",
  chain: "连锁跳电",
};
export function ResultDialog({
  doc,
  restart,
}: {
  doc: GameDoc;
  restart: () => void;
}) {
  const total = doc.stats.bySource.direct +
    doc.stats.bySource.periodic +
    doc.stats.bySource.chain;
  return (
    <div className="overlay">
      <div className="result-dialog">
        <div className="eyebrow">
          MISSION {doc.victory ? "COMPLETE" : "ENDED"}
        </div>
        <h2>{doc.victory ? "信号已送达。" : "信号暂时中断。"}</h2>
        <p>每一次坠落，都是下一次进化的起点。</p>
        <div className="result-grid">
          <div>
            <strong>{formatTime(doc.time)}</strong>
            <small>生存时间</small>
          </div>
          <div>
            <strong>{doc.stats.kills}</strong>
            <small>击败敌人</small>
          </div>
          <div>
            <strong>{doc.level}</strong>
            <small>最终等级</small>
          </div>
        </div>
        <div className="damage-breakdown">
          {(["direct", "periodic", "chain"] as DamageSource[]).map((key) => {
            const value = doc.stats.bySource[key];
            const share = total ? (value / total) * 100 : 0;
            return (
              <div key={key}>
                <span>{SOURCE_LABEL[key]}</span>
                <span className="mono">
                  {Math.round(value)} DMG · {share.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
        <p className="tiny">
          三类贡献合计 {Math.round(total)} = 实际扣血 {Math.round(doc.stats.damage)}
        </p>
        <button className="primary" onClick={restart}>
          重新接入 ↗
        </button>
        <p className="tiny">本地已记录 {doc.records.length} 次行动</p>
      </div>
    </div>
  );
}
