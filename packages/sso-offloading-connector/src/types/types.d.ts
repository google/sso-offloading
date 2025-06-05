/* https://wicg.github.io/controlled-frame/#html-element */
interface ControlledFrame extends HTMLElement {
  src: string;
  name: string;
  allowfullscreen: boolean;
  allowscaling: boolean;
  allowtransparency: boolean;
  autosize: boolean;
  maxheight: string;
  maxwidth: string;
  minheight: string;
  minwidth: string;
  partition: string;

  readonly contentWindow: WindowProxy;
  readonly contextMenus: ContextMenus;
  readonly request: WebRequest;

  // Navigation methods
  back(): Promise<void>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  forward(): Promise<void>;
  go(relativeIndex?: number): Promise<void>;
  reload(): void;
  stop(): void;

  // Scripting Methods
  addContentScripts(contentScriptList: ContentScriptDetails[]): Promise<void>;
  executeScript(details?: InjectDetails | {}): Promise<any>;
  insertCSS(details?: InjectDetails): Promise<void>;
  removeContentScripts(scriptNameList: string[]): Promise<void>;

  // Configuration methods
  clearData(options: ClearDataOptions = {}): Promise<void>;
  getAudioState(): Promise<boolean>;
  getZoom(): Promise<number>;
  isAudioMuted(): Promise;
  setAudioMuted(mute: boolean): void;
  setZoom(zoomFactor: number): Promise<void>;

  // Capture methods
  captureVisibleRegion(): void;
  print(): void;
}

interface ExtensionMessage {
  url: string;
}
