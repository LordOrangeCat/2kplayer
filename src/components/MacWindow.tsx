import type { ReactNode } from "react";

interface Props {
  title: string;
  right?: ReactNode;
  onBox?: () => void;
  boxLabel?: string;
  className?: string;
  children: ReactNode;
}

export function MacWindow({ title, right, onBox, boxLabel, className, children }: Props) {
  return (
    <div className={`mac-window ${className ?? ""}`}>
      <div className="mac-titlebar">
        <span className="mac-title">{title}</span>
        <div className="flex items-center gap-2">
          {right}
          {onBox && (
            <button className="mac-box" onClick={onBox} aria-label={boxLabel} title={boxLabel}>
              <span />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
