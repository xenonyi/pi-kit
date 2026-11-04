/** Where a new terminal goes: beside this session, in a new tab, or hidden. */
export type Placement = "pane" | "tab" | "background";

/** The split directions herdr-app accepts. */
export type Direction = "right" | "down";

export interface MachineInfo {
	name: string;
	state: string;
}

export interface TerminalInfo {
	address: string;
	name: string;
	agent: string;
	cwd: string;
	parent: string | null;
	/** Lifecycle state from hc, currently "live". */
	state: string;
	/** OSC 7501 status: idle / working / done / blocked / error; "" when the program reports none. */
	status: string;
	/** Completed turns: every time the program leaves working this goes up by one. */
	turn: number;
	/** Place the window shows it in, for example "pi-kit / 1". */
	where: string;
	isMe: boolean;
}

/** Where a terminal is shown in the window. */
export interface WindowLocation {
	pane: string | null;
	space: string | null;
	spaceName: string | null;
	tab: string | null;
	tabName: string | null;
	app: string | null;
	name: string | null;
	status: string | null;
}

export interface WindowInfo {
	open: boolean;
	/** Why the window could not be read, when it could not. */
	problem: string | null;
	/** Problems the window reports about its own modules, not about this command. */
	errors: string[];
	focusedPane: string | null;
	spaces: WindowSpace[];
}

export interface WindowSpace {
	id: string;
	name?: string | null;
	tabs?: Array<{
		id: string;
		name?: string | null;
		terminals?: Array<{
			terminal: string;
			pane?: string | null;
			status?: string | null;
			app?: string | null;
			name?: string | null;
		}>;
	}>;
}

export interface Snapshot {
	/** HC_TERMINAL_ID of this session; null outside a herdr terminal. */
	me: string | null;
	/** Where this session's terminal is shown. */
	location: WindowLocation;
	focusedPane: string | null;
	windowOpen: boolean;
	windowProblem: string | null;
	windowErrors: string[];
	machines: MachineInfo[];
	terminals: TerminalInfo[];
	hiddenFinished: number;
}

export interface StartResult {
	address: string;
	name: string;
	placement: Placement;
	cwd: string;
	parent: string | null;
	/** False is the only proof the terminal outlives this session. */
	outliveParent: boolean;
	state: string;
	status: string;
	turn: number;
	pane: string | null;
	spaceName: string | null;
	tabName: string | null;
	/** Written when the task was too long or too quote-heavy to pass verbatim. */
	taskFile: string | null;
	steps: string[];
	warnings: string[];
}
