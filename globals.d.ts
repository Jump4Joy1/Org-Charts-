// Ambient declarations so `tsc --checkJs` can check the app without a build
// step. The three modules attach themselves to window; this tells the
// checker they exist.
interface Window {
  OrgChartTokens: any;
  OrgChartSchema: any;
  OrgChartCommands: any;
}
interface Error {
  /** HTTP status attached by httpJson so callers can branch on 401. */
  status?: number;
}
