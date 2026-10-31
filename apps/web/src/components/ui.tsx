"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../client/api";
import { Icon } from "./icon";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="loading-indicator" role="status">
      <span className="spinner" />
      {label}
      <span className="sr-only">, please wait</span>
    </span>
  );
}
export function Notice({
  children,
  kind = "error",
}: {
  children: ReactNode;
  kind?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <Icon name={kind === "success" ? "check" : "info"} />
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
  icon = "court",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: "court" | "ticket" | "calendar" | "shield";
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={30} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
const DialogBusyContext = createContext<((value: boolean) => void) | null>(
  null,
);
export function useDialogBusy(busy: boolean) {
  const setBusy = useContext(DialogBusyContext);
  useEffect(() => {
    setBusy?.(busy);
    return () => setBusy?.(false);
  }, [busy, setBusy]);
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [working, setWorking] = useState(false);
  const locked = busy || working;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={locked}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <DialogBusyContext.Provider value={setWorking}>
          {children}
        </DialogBusyContext.Provider>
      </div>
    </dialog>
  );
}

export function useRequest<T>(path: string | null, auth = false) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path: null, data: null, error: "", loading: false });
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((previous) => ({
      path,
      data: previous.path === path ? previous.data : null,
      error: "",
      loading: true,
    }));
    void api<T>(path, { auth, signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            path,
            error: errorMessage(error),
            loading: false,
          }));
      });
    return () => controller.abort();
  }, [path, revision, auth]);
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : "",
    loading: Boolean(path) && (state.path !== path || state.loading),
    reload,
  };
}
