import { useEffect, useState } from 'react';
import { fetchReport, type Mode } from './api';
import { dayLabel, dayTitle, directionLines, explainer, GRADE_COLORS, headline, trainLines, watchedText, type LineReport } from './report';
import { everyWhileVisible } from './visible';

/** Today's card fills in through the day; once every few minutes is plenty. */
const REFRESH_MS = 3 * 60 * 1000;

/** A line's report cards. Null until they load, or when they can't be. */
function useReport(key: string): LineReport | null {
  const [report, setReport] = useState<LineReport | null>(null);
  useEffect(() => {
    setReport(null);
    const controller = new AbortController();
    const load = () =>
      fetchReport(key, controller.signal)
        .then(setReport)
        .catch(() => {});
    void load();
    const stop = everyWhileVisible(load, REFRESH_MS);
    return () => {
      controller.abort();
      stop();
    };
  }, [key]);
  return report;
}

/** How a line has run today and on the days before: a grade, and the numbers behind it when opened. */
export function ReportCard({ lineKey, mode }: { lineKey: string; mode: Mode }) {
  const report = useReport(lineKey);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setPicked(null);
  }, [lineKey]);
  if (!report?.days.length || report.key !== lineKey) return null;
  const day = report.days.find((d) => d.date === picked) ?? report.days[0];
  const directions = (day.directions ?? []).map((d) => directionLines(d, mode));
  const trains = report.kind === 'ontime' ? trainLines(day) : [];

  return (
    <section className="report-card" aria-label="Report card">
      <button className="report-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="report-grade" style={day.grade ? { background: GRADE_COLORS[day.grade] } : undefined} aria-hidden="true">
          {day.grade ?? '–'}
        </span>
        <span className="report-text">
          <span className="report-eyebrow">Report card · {dayTitle(day)}</span>
          <span className="report-headline">
            {day.grade && <span className="visually-hidden">Grade {day.grade}: </span>}
            {headline(report.kind, day, mode)}
          </span>
          <span className="muted small">{watchedText(day)}</span>
        </span>
        <span className="report-chevron" aria-hidden="true" />
      </button>

      {report.days.length > 1 && (
        <div className="report-days" role="tablist" aria-label="Day">
          {report.days.map((d) => (
            <button key={d.date} role="tab" aria-selected={d === day} onClick={() => setPicked(d.date)}>
              <span>{dayLabel(d)}</span>
              <strong style={d.grade ? { color: GRADE_COLORS[d.grade] } : undefined}>{d.grade ?? '–'}</strong>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="report-details">
          {directions.map((d, i) => (
            <div key={i}>
              <h3>{d.title}</h3>
              <ul>
                {d.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          {trains.length > 0 && (
            <ul>
              {trains.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <p className="muted small">{explainer(report.kind, mode)}</p>
        </div>
      )}
    </section>
  );
}
