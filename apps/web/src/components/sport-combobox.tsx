"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sports } from "../client/format";
import { Icon } from "./icon";

const options = sports.slice(1);
const sportIcon = (sport: string) =>
  ["Badminton", "Tennis", "Pickleball"].includes(sport) ? "racket" : "ball";

export function SportCombobox({ defaultValue = "Badminton", error, errorId }: { defaultValue?: string; error?: string | undefined; errorId?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = options.filter((sport) => sport.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (open && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function expand() {
    setQuery("");
    setActive(options.findIndex((sport) => sport === value));
    setOpen(true);
  }

  function choose(sport: string) {
    setValue(sport);
    setOpen(false);
    input.current?.focus();
  }

  return (
    <div
      className="sport-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>Sport</label>
      <div className={`sport-combobox ${open ? "is-open" : ""}`}>
        <div className="sport-combobox-control">
          <span className="sport-combobox-icon"><Icon name={sportIcon(value)} size={19} /></span>
          <input
            ref={input}
            id={id}
            name="sport"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-describedby={[`${id}-hint`, error ? errorId : undefined].filter(Boolean).join(" ")}
            aria-invalid={Boolean(error)}
            aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
            autoComplete="off"
            required
            maxLength={60}
            value={value}
            placeholder="Search or enter a sport"
            onClick={() => { if (!open) expand(); }}
            onChange={(event) => {
              setValue(event.target.value);
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!open) { expand(); return; }
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((previous) => {
                  if (!matches.length) return -1;
                  if (previous < 0) return step === 1 ? 0 : matches.length - 1;
                  return (previous + step + matches.length) % matches.length;
                });
              } else if (event.key === "Enter" && open) {
                event.preventDefault();
                if (matches[active]) choose(matches[active]);
                else setOpen(false);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "Tab") {
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            className="sport-combobox-toggle"
            aria-label={open ? "Hide sport options" : "Show sport options"}
            aria-controls={`${id}-options`}
            aria-expanded={open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              input.current?.focus();
              if (open) setOpen(false);
              else expand();
            }}
          >
            <Icon name="down" size={18} />
          </button>
        </div>
        {open && (
          <div className="sport-combobox-panel">
            <span className="sport-combobox-heading">CHOOSE YOUR SPORT</span>
            <ul ref={list} id={`${id}-options`} role="listbox" aria-label="Sports" className="sport-combobox-options">
              {matches.map((sport, index) => (
                <li
                  key={sport}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={sport === value}
                  className={index === active ? "is-active" : ""}
                  onPointerMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(sport)}
                >
                  <span className="sport-option-icon"><Icon name={sportIcon(sport)} size={18} /></span>
                  <span>{sport}</span>
                  {sport === value && <Icon name="check" size={17} className="sport-option-check" />}
                </li>
              ))}
            </ul>
            {!matches.length && <p className="sport-combobox-empty" role="status">No suggestions. You can use the sport you entered.</p>}
          </div>
        )}
      </div>
      <span id={`${id}-hint`} className="field-hint">Choose a sport or enter your own before scheduling slots.</span>
      {error && <span id={errorId} className="field-error">{error}</span>}
    </div>
  );
}
