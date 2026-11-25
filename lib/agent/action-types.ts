import type { CalEvent } from "@/lib/google/types";

/** One bookable time option on a create proposal. Times are absolute ISO instants. */
export type SlotOption = { start: string; end: string; label: string; reason?: string };

export type CreateEventProposal = {
  kind: "create_event";
  title: string;
  description?: string;
  location?: string;
  attendees: string[];
  addMeetLink: boolean;
  options: SlotOption[];
  /** Set when the user approves one of the options. */
  chosenOption?: number;
};

export type UpdateEventProposal = {
  kind: "update_event";
  eventId: string;
  eventTitle: string;
  currentLabel: string;
  newLabel?: string;
  changes: {
    title?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    addAttendees?: string[];
    removeAttendees?: string[];
  };
};

export type DeleteEventProposal = {
  kind: "delete_event";
  eventId: string;
  eventTitle: string;
  currentLabel: string;
  attendeeCount: number;
};

export type ActionProposal = (CreateEventProposal | UpdateEventProposal | DeleteEventProposal) & {
  reason?: string;
  /** Things the user should know before approving: clashes, attendees who'll be notified, ownership. */
  warnings?: string[];
};

/** Before/after state stored on executed actions, for undo. */
export type EventSnapshot = CalEvent;

/** What propose_* tools return to the model and the approval card. */
export type ProposalToolOutput = {
  actionId: string;
  status: "awaiting_user_approval";
  summary: string;
  proposal: ActionProposal;
};

/** What the actions API returns to the approval card. */
export type ActionState = {
  id: string;
  status: "proposed" | "executing" | "executed" | "rejected" | "failed" | "undoing" | "undone";
  summary: string;
  error?: string | null;
  eventLink?: string;
  resultLabel?: string;
};
