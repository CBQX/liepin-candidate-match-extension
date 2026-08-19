import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Job } from "../../shared/contracts/job";

interface JobSelectorProps {
  jobs: readonly Job[];
  activeJobId?: string;
  disabled?: boolean;
  onChange(id: string): void;
  onAdd(): void;
}

function jobDisplay(job: Job) {
  return {
    roleTitle: job.recruitmentProfile?.roleTitle ?? "待确认岗位",
    company: job.company
  };
}

export function JobSelector({ jobs, activeJobId, disabled, onChange, onAdd }: JobSelectorProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const labelId = useId();
  const listboxId = useId();
  const activeIndex = jobs.findIndex((job) => job.id === activeJobId);
  const activeJob = activeIndex >= 0 ? jobs[activeIndex] : undefined;

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[focusedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [focusedIndex, open]);

  function openMenu() {
    if (disabled || jobs.length === 0) return;
    setFocusedIndex(activeIndex >= 0 ? activeIndex : 0);
    setOpen(true);
  }

  function chooseJob(index: number) {
    const job = jobs[index];
    if (!job) return;
    setOpen(false);
    if (job.id !== activeJobId) onChange(job.id);
  }

  function moveFocus(delta: number) {
    setFocusedIndex((current) => {
      const start = open ? current : (activeIndex >= 0 ? activeIndex : 0);
      return (start + delta + jobs.length) % jobs.length;
    });
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || jobs.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        setFocusedIndex(0);
        setOpen(true);
        break;
      case "End":
        event.preventDefault();
        setFocusedIndex(jobs.length - 1);
        setOpen(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) chooseJob(focusedIndex);
        else openMenu();
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
    }
  }

  const activeDisplay = activeJob ? jobDisplay(activeJob) : {
    roleTitle: "请选择岗位",
    company: "尚未选择招聘岗位"
  };

  return (
    <section className="job-toolbar" aria-label="岗位选择">
      <div
        className="job-selector"
        ref={containerRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span className="job-selector-label" id={labelId}>当前岗位</span>
        <button
          className="job-select-trigger"
          type="button"
          role="combobox"
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open ? `${listboxId}-option-${focusedIndex}` : undefined}
          disabled={disabled || jobs.length === 0}
          onClick={() => open ? setOpen(false) : openMenu()}
          onKeyDown={handleKeyDown}
        >
          <span className="job-select-copy">
            <strong className="job-role-title">{activeDisplay.roleTitle}</strong>
            <span className="job-company">{activeDisplay.company}</span>
          </span>
          <span className="job-select-chevron" aria-hidden="true">⌄</span>
        </button>

        {open && (
          <ul className="job-select-menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
            {jobs.map((job, index) => {
              const display = jobDisplay(job);
              const selected = job.id === activeJobId;
              const focused = index === focusedIndex;
              return (
                <li
                  className={`job-select-option${focused ? " job-select-option-focused" : ""}`}
                  id={`${listboxId}-option-${index}`}
                  key={job.id}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  aria-label={`${display.roleTitle}，${display.company}`}
                  aria-selected={selected}
                  onClick={() => chooseJob(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => setFocusedIndex(index)}
                >
                  <span className="job-select-copy">
                    <strong className="job-role-title">{display.roleTitle}</strong>
                    <span className="job-company">{display.company}</span>
                  </span>
                  {selected && <span className="job-selected-mark" aria-hidden="true">✓</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button className="secondary-button" type="button" onClick={onAdd}>添加新岗位</button>
    </section>
  );
}
