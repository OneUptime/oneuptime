import React, { FunctionComponent, ReactElement, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Query from 'Common/Types/BaseDatabase/Query';
import Log from 'Common/Models/AnalyticsModels/Log';
import Includes from 'Common/Types/BaseDatabase/Includes';
import ObjectID from 'Common/Types/ObjectID';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import AnalyticsModelAPI, { ListResult } from 'Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI';
import API from 'Common/UI/Utils/API/API';
import Realtime from 'Common/UI/Utils/Realtime';
import ProjectUtil from 'Common/UI/Utils/Project';
import ModelEventType from 'Common/Types/Realtime/ModelEventType';
import Select from 'Common/Types/BaseDatabase/Select';
import ErrorMessage from 'Common/UI/Components/ErrorMessage/ErrorMessage';
import ComponentLoader from 'Common/UI/Components/ComponentLoader/ComponentLoader';
import Button, { ButtonStyleType, ButtonSize } from 'Common/UI/Components/Button/Button';
import IconProp from 'Common/Types/Icon/IconProp';
import SideOver, { SideOverSize } from 'Common/UI/Components/SideOver/SideOver';
import JSONFunctions from 'Common/Types/JSONFunctions';
import CopyTextButton from 'Common/UI/Components/CopyTextButton/CopyTextButton';
import Toggle from 'Common/UI/Components/Toggle/Toggle';
import Card from 'Common/UI/Components/Card/Card';
import DropdownUtil from 'Common/UI/Utils/Dropdown';
import FiltersForm from 'Common/UI/Components/Filters/FiltersForm';
import FieldType from 'Common/UI/Components/Types/FieldType';
import LogSeverity from 'Common/Types/Log/LogSeverity';
import LogVolumeChart from './LogVolumeChart';
import Icon from 'Common/UI/Components/Icon/Icon';
import OneUptimeDate from 'Common/Types/Date';
// Added for dynamic attribute loading
import ModelAPI from 'Common/UI/Utils/ModelAPI/ModelAPI';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { JSONObject } from 'Common/Types/JSON';
import { APP_API_URL } from 'Common/UI/Config';

// Props mirror existing simple LogsViewer container (Dashboard version)
export interface ComponentProps {
  id: string;
  telemetryServiceIds?: Array<ObjectID> | undefined;
  enableRealtime?: boolean;
  traceIds?: Array<string> | undefined;
  spanIds?: Array<string> | undefined;
  showFilters?: boolean | undefined;
  noLogsMessage?: string | undefined;
  logQuery?: Query<Log> | undefined;
  limit?: number | undefined;
}

// Internal helper types
interface VirtualItem { index: number; start: number; end: number; }

const ROW_HEIGHT = 28; // px baseline for collapsed rows
const BUFFER_ROWS = 20;

const AdvancedLogViewer: FunctionComponent<ComponentProps> = (props: ComponentProps): ReactElement => {
  // ------------ Query Assembly -------------
  const refreshQuery = (): Query<Log> => {
    const query: Query<Log> = {};
    if (props.telemetryServiceIds && props.telemetryServiceIds.length > 0) {
      query.serviceId = new Includes(props.telemetryServiceIds);
    }
    if (props.traceIds && props.traceIds.length > 0) {
      query.traceId = new Includes(props.traceIds);
    }
    if (props.spanIds && props.spanIds.length > 0) {
      query.spanId = new Includes(props.spanIds);
    }
    if (props.logQuery && Object.keys(props.logQuery).length > 0) {
      for (const key in props.logQuery) {
        (query as any)[key] = (props.logQuery as any)[key] as any;
      }
    }
    return query;
  };

  const select: Select<Log> = {
    body: true,
    time: true,
    projectId: true,
    serviceId: true,
    spanId: true,
    traceId: true,
    severityText: true,
    attributes: true,
  };

  // ------------ State -------------
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<Array<Log>>([]);
  const [filterOptions, setFilterOptions] = useState<Query<Log>>(refreshQuery());
  const [liveTail, setLiveTail] = useState<boolean>(true);
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [showJSON, setShowJSON] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<Array<LogSeverity>>([]);
  const [selectedLog, setSelectedLog] = useState<Log | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [logAttributes, setLogAttributes] = useState<Array<string>>([]);
  const [initialLoadingAttributes, setInitialLoadingAttributes] = useState<boolean>(true);
  const [attributeError, setAttributeError] = useState<string>('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState<number>(600);
  const [scrollTop, setScrollTop] = useState<number>(0);

  // ------------ Effects -------------
  useEffect(() => { setFilterOptions(refreshQuery()); }, [props.telemetryServiceIds, props.traceIds, props.spanIds, props.logQuery]);

  useEffect(() => { fetchLogs().catch((err: unknown) => setError(API.getFriendlyMessage(err))); }, [filterOptions]);

  // Realtime batching for performance
  useEffect(() => {
    if (!props.enableRealtime || !liveTail) { return; }
    let buffer: Array<Log> = [];
    let raf: number | null = null;
    const flush = () => {
      if (buffer.length === 0) { return; }
      setLogs(prev => [...prev, ...buffer]);
      buffer = [];
      raf = null;
    };
    const scheduleFlush = () => {
      if (raf === null) { raf = window.requestAnimationFrame(flush); }
    };
    const disconnect = Realtime.listenToAnalyticsModelEvent({ modelType: Log, eventType: ModelEventType.Create, tenantId: ProjectUtil.getCurrentProjectId()! }, (model: Log) => {
      buffer.push(model);
      scheduleFlush();
    });
    return () => { disconnect(); if (raf) { cancelAnimationFrame(raf); } flush(); };
  }, [props.enableRealtime, liveTail]);

  useEffect(() => { if (autoScroll && containerRef.current) { containerRef.current.scrollTop = containerRef.current.scrollHeight; } }, [logs, autoScroll]);

  useEffect(() => {
    const handleResize = () => { if (containerRef.current) { setViewportHeight(containerRef.current.clientHeight); } };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Load attributes from backend for advanced filtering (real implementation)
  useEffect(() => {
    let isMounted = true;
    const loadAttributes = async () => {
      try {
        setInitialLoadingAttributes(true);
        setAttributeError('');
        const attributeResponse: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
          URL.fromString(APP_API_URL.toString()).addRoute('/telemetry/logs/get-attributes'),
          {},
          {
            ...ModelAPI.getCommonHeaders(),
          }
        );
        if (attributeResponse instanceof HTTPErrorResponse) {
          throw attributeResponse;
        }
        const attributes: Array<string> = (attributeResponse.data['attributes'] as Array<string>) || [];
        if (isMounted) {
          setLogAttributes(attributes.sort());
          setInitialLoadingAttributes(false);
        }
      } catch (err) {
        if (isMounted) {
          setInitialLoadingAttributes(false);
          setAttributeError(API.getFriendlyMessage(err));
        }
      }
    };
    loadAttributes().catch(() => { /* handled above */ });
    return () => { isMounted = false; };
  }, []);

  // ------------ Data Fetch -------------
  const fetchLogs = async (): Promise<void> => {
    setError('');
    setIsLoading(true);
    try {
      const listResult: ListResult<Log> = await AnalyticsModelAPI.getList<Log>({ modelType: Log, query: filterOptions, limit: props.limit || LIMIT_PER_PROJECT, skip: 0, select, sort: { time: SortOrder.Descending }, requestOptions: {} });
      listResult.data.reverse(); // oldest at top, newest bottom
      setLogs(listResult.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  // ------------ Derived Data -------------
  const filteredLogs = useMemo(() => logs.filter(log => {
    if (severityFilter.length > 0 && log.severityText && !severityFilter.includes(log.severityText as LogSeverity)) { return false; }
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      const body = (log.body || '').toString().toLowerCase();
      if (!body.includes(t) && !(log.traceId || '').toString().toLowerCase().includes(t) && !(log.spanId || '').toString().toLowerCase().includes(t)) { return false; }
    }
    return true;
  }), [logs, severityFilter, searchTerm]);

  // Time range management
  const [timeRangePreset, setTimeRangePreset] = useState<string>('');
  const applyTimeRangePreset = (preset: string) => {
    const now = new Date();
    let from: Date | null = null;
    if (preset === '5m') { from = new Date(now.getTime() - 5*60_000); }
    else if (preset === '15m') { from = new Date(now.getTime() - 15*60_000); }
    else if (preset === '1h') { from = new Date(now.getTime() - 60*60_000); }
    else if (preset === '6h') { from = new Date(now.getTime() - 6*60*60_000); }
    else if (preset === '24h') { from = new Date(now.getTime() - 24*60*60_000); }
    setTimeRangePreset(preset);
    if (from) {
      setFilterOptions(prev => ({ ...prev, time: { $gte: from, $lte: now } as any }));
    } else {
      setFilterOptions(prev => { const clone = { ...prev }; delete (clone as any).time; return clone; });
    }
  };

  const currentTimeFilter = filterOptions.time as any | undefined;
  const chartFrom: Date | null = currentTimeFilter?.$gte || null;
  const chartTo: Date | null = currentTimeFilter?.$lte || null;

  // Attribute filter add helper
  const addAttributeFilter = useCallback((key: string, value: string) => {
    setFilterOptions(prev => {
      const attrs = { ...(prev.attributes as any || {}) };
      (attrs as any)[key] = value;
      return { ...prev, attributes: attrs as any };
    });
  }, []);

  const activeChips: any[] = [];
  if (searchTerm) { activeChips.push({ label: `Search: ${searchTerm}`, onRemove: ()=> setSearchTerm('') }); }
  severityFilter.forEach(sev => activeChips.push({ label: `Severity: ${sev}`, onRemove: ()=> setSeverityFilter(prev=> prev.filter(s=> s!==sev)) }));
  if (timeRangePreset) { activeChips.push({ label: `Range: ${timeRangePreset}`, onRemove: ()=> { setTimeRangePreset(''); setFilterOptions(prev => { const clone = { ...prev }; delete (clone as any).time; return clone; }); } }); }
  // Extract attribute filters (loosened typing to avoid deep recursive instantiation)
  const attributeFilters: any | undefined = (filterOptions as any).attributes;
  if (attributeFilters && typeof attributeFilters === 'object') {
    Object.keys(attributeFilters).forEach(k => {
      activeChips.push({
        label: `${k}: ${attributeFilters[k]}`,
        onRemove: () => setFilterOptions(prev => {
          const clone: any = { ...prev };
          const attrs: any = { ...(clone.attributes || {}) };
          delete attrs[k];
          if (Object.keys(attrs).length === 0) { delete clone.attributes; } else { clone.attributes = attrs; }
          return clone;
        })
      });
    });
  }

  // ------------ Virtualization -------------
  const total = filteredLogs.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endIndex = Math.min(total - 1, Math.floor((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const virtualItems: Array<VirtualItem> = [];
  for (let i = startIndex; i <= endIndex; i++) { virtualItems.push({ index: i, start: i * ROW_HEIGHT, end: (i+1)*ROW_HEIGHT }); }
  const totalHeight = total * ROW_HEIGHT;

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    if (autoScroll && (target.scrollHeight - target.scrollTop - target.clientHeight) > 10) { setAutoScroll(false); }
  };

  // ------------ Render Helpers -------------
  const getSeverityColor = (sev?: LogSeverity): string => {
    switch(sev) {
      case LogSeverity.Error: return 'text-rose-400';
      case LogSeverity.Fatal: return 'text-rose-500';
      case LogSeverity.Warning: return 'text-amber-400';
      case LogSeverity.Debug: return 'text-slate-400';
      case LogSeverity.Trace: return 'text-slate-400';
      case LogSeverity.Information: return 'text-sky-400';
      default: return 'text-slate-200';
    }
  };

  const toggleSeverity = (sev: LogSeverity) => {
    setSeverityFilter(prev => prev.includes(sev) ? prev.filter(s => s!==sev) : [...prev, sev]);
  };

  // ------------ UI -------------
  if (error) { return <ErrorMessage message={error} />; }

  return (
    <div id={props.id} className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center space-x-2 flex-wrap">
        <div className="flex items-center bg-white rounded-md border border-gray-200 px-2">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search body / trace / span"
            className="px-2 py-1 text-sm focus:outline-none"
          />
          {searchTerm && (
            <Button title="Clear" buttonStyle={ButtonStyleType.LINK} buttonSize={ButtonSize.Small} onClick={() => setSearchTerm('')} />
          )}
        </div>
        <div className="flex items-center space-x-1">
          {['5m','15m','1h','6h','24h'].map(preset => (
            <button key={preset} className={`text-xs px-2 py-1 rounded border ${timeRangePreset===preset?'bg-indigo-600 text-white border-indigo-600':'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`} onClick={()=>applyTimeRangePreset(preset)}>{preset}</button>
          ))}
        </div>
        <div className="flex items-center space-x-1">
          {Object.values(LogSeverity).filter(v=> typeof v === 'string').map((sev, i) => (
            <button key={i} className={`text-xs px-2 py-1 rounded border ${severityFilter.includes(sev as LogSeverity)?'bg-indigo-600 text-white border-indigo-600':'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`} onClick={()=>toggleSeverity(sev as LogSeverity)}>{sev}</button>
          ))}
        </div>
        <Toggle title="Wrap" value={wrapLines} onChange={(v)=>setWrapLines(v)} />
        <Toggle title="JSON" value={showJSON} onChange={(v)=>setShowJSON(v)} />
        {props.enableRealtime && (
          <div className="flex items-center space-x-1">
            <Toggle title="Live Tail" value={liveTail} onChange={(v)=>setLiveTail(v)} />
            <span className={`text-xs px-2 py-1 rounded-full ${liveTail? 'bg-green-100 text-green-700 animate-pulse':'bg-gray-200 text-gray-600'}`}>{liveTail? 'Streaming':'Paused'}</span>
          </div>
        )}
        <Toggle title="Auto Scroll" value={autoScroll} onChange={(v)=>setAutoScroll(v)} />
        <Button title="Refresh" icon={IconProp.Refresh} buttonSize={ButtonSize.Small} buttonStyle={ButtonStyleType.OUTLINE} onClick={()=>fetchLogs()} />
        {props.showFilters && (
          <Button title="Apply Filters" icon={IconProp.Search} buttonSize={ButtonSize.Small} buttonStyle={ButtonStyleType.PRIMARY} onClick={()=>fetchLogs()} />
        )}
      </div>

      {/* Active Filter Chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2">{
          activeChips.map((chip, i) => (
            <button key={i} className="flex items-center space-x-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-3 py-0.5 text-xs hover:bg-indigo-100" onClick={chip.onRemove}>
              <span>{chip.label}</span>
              <Icon icon={IconProp.Close} className="h-3 w-3" />
            </button>
          ))
        }</div>
      )}

      {/* Volume Chart */}
      <LogVolumeChart logs={filteredLogs} from={chartFrom} to={chartTo} />

      {/* Advanced Filters (if requested) */}
      {props.showFilters && (
        <Card>
          <FiltersForm<Log>
            id="advanced-log-filters"
            showFilter={true}
            filterData={filterOptions}
            onFilterChanged={(f: Query<Log>)=> setFilterOptions(f)}
            filters={[
              { key: 'body', type: FieldType.Text, title: 'Search Log' },
              { key: 'severityText', filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(LogSeverity), type: FieldType.Dropdown, title: 'Severity', isAdvancedFilter: true },
              { key: 'time', type: FieldType.DateTime, title: 'Start / End', isAdvancedFilter: true },
              { key: 'attributes', type: FieldType.JSON, title: 'Attributes', jsonKeys: logAttributes, isAdvancedFilter: true },
            ]}
          />
          {initialLoadingAttributes ? (
            <div className="text-sm text-gray-400">Loading attribute keys...</div>
          ) : <></>}
          {!initialLoadingAttributes && attributeError ? (
            <div className="text-xs text-rose-500">Failed to load attribute keys: {attributeError}</div>
          ) : <></>}
        </Card>
      )}

      {/* Log List */}
      <div ref={containerRef} onScroll={onScroll} className="relative bg-slate-900 rounded-lg border border-slate-800 h-[600px] overflow-auto text-xs font-mono dark-scrollbar">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm z-10">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && filteredLogs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="text-slate-300 font-medium">{props.noLogsMessage || 'No logs match the current criteria.'}</div>
            <div className="text-slate-500 text-xs max-w-md">Try adjusting time range, removing filters, or enabling Live Tail to stream new logs.</div>
            <div className="flex space-x-2">
              <Button title="Clear Filters" buttonStyle={ButtonStyleType.OUTLINE} buttonSize={ButtonSize.Small} onClick={()=> { setSearchTerm(''); setSeverityFilter([]); setTimeRangePreset(''); setFilterOptions(refreshQuery()); }} />
              {props.enableRealtime && !liveTail && <Button title="Enable Live Tail" buttonStyle={ButtonStyleType.PRIMARY} buttonSize={ButtonSize.Small} onClick={()=> setLiveTail(true)} />}
            </div>
          </div>
        )}
        {!liveTail && props.enableRealtime && (
          <div className="sticky top-0 z-20 w-full bg-amber-50 text-amber-700 text-xs px-3 py-1 flex items-center space-x-2 border-b border-amber-200">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            <span>Live tail paused. New logs will not stream automatically.</span>
            <Button title="Resume" buttonStyle={ButtonStyleType.LINK} buttonSize={ButtonSize.Small} onClick={()=> setLiveTail(true)} />
          </div>
        )}
        <div style={{ height: totalHeight }} className={wrapLines ? 'whitespace-pre-wrap' : 'whitespace-pre'}>
          {virtualItems.map(vi => {
            const log = filteredLogs[vi.index];
            if (!log) { return null; }
            const body = log.body?.toString() || '';
            let jsonBody: string | null = null;
            if (showJSON) {
              try { jsonBody = JSON.stringify(JSON.parse(body), null, 2); } catch { jsonBody = null; }
            }
            const sevColor = getSeverityColor(log.severityText as LogSeverity);
            return (
              <div
                key={vi.index}
                style={{ position: 'absolute', top: vi.start, left: 0, right: 0 }}
                className={`px-2 py-0.5 cursor-pointer hover:bg-slate-800/60 ${selectedLog === log ? 'bg-slate-800' : ''}`}
                onClick={()=> setSelectedLog(log)}
              >
                <span className="text-slate-500">{log.time ? OneUptimeDate.getDateAsUserFriendlyFormattedString(log.time) : ''}</span>{' '}
                <span className={sevColor}>[{log.severityText}]</span> {' '}
                {jsonBody && <span className="text-slate-300">{jsonBody.split('\n')[0]}</span>}
                {!jsonBody && <span className="text-slate-200">{body.substring(0, 300)}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Side Panel for details */}
      {selectedLog && (
        <SideOver
          title={selectedLog.body?.toString().slice(0,80) || 'Log Details'}
          description={`Time: ${selectedLog.time ? OneUptimeDate.getDateAsUserFriendlyFormattedString(selectedLog.time) : ''}`}
          onClose={()=> setSelectedLog(null)}
          size={SideOverSize.Medium}
        >
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-gray-500">Raw Body</h3>
              <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">{selectedLog.body?.toString()}</pre>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-gray-500">Parsed JSON</h3>
              <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">{(()=>{ try { return JSON.stringify(JSON.parse(selectedLog.body?.toString() || ''), null, 2);} catch { return 'Not valid JSON'; } })()}</pre>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {selectedLog.traceId && <div className="text-xs"><span className="font-semibold">Trace:</span> {selectedLog.traceId} <CopyTextButton textToBeCopied={selectedLog.traceId.toString()} /></div>}
              {selectedLog.spanId && <div className="text-xs"><span className="font-semibold">Span:</span> {selectedLog.spanId} <CopyTextButton textToBeCopied={selectedLog.spanId.toString()} /></div>}
              {selectedLog.severityText && <div className="text-xs"><span className="font-semibold">Severity:</span> {selectedLog.severityText}</div>}
            </div>
            {selectedLog.attributes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500">Attributes</h3>
                <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-72">{JSON.stringify(JSONFunctions.unflattenObject(selectedLog.attributes), null, 2)}</pre>
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.keys(JSONFunctions.unflattenObject(selectedLog.attributes || {})).map(k => (
                    <button key={k} className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300" onClick={()=> addAttributeFilter(k, (JSONFunctions.unflattenObject(selectedLog.attributes || {}) as any)[k])}>Filter {k}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex space-x-2">
              <Button title={wrapLines? 'Unwrap' : 'Wrap'} buttonStyle={ButtonStyleType.OUTLINE} buttonSize={ButtonSize.Small} onClick={()=> setWrapLines(w=>!w)} />
              <Button title="Copy JSON" icon={IconProp.Copy} buttonStyle={ButtonStyleType.OUTLINE} buttonSize={ButtonSize.Small} onClick={()=>{ try { navigator.clipboard.writeText(JSON.stringify(JSON.parse(selectedLog.body?.toString()||''), null, 2)); } catch { navigator.clipboard.writeText(selectedLog.body?.toString()||''); } }} />
              <Button title="Close" buttonStyle={ButtonStyleType.NORMAL} buttonSize={ButtonSize.Small} onClick={()=> setSelectedLog(null)} />
            </div>
          </div>
        </SideOver>
      )}
    </div>
  );
};

export default AdvancedLogViewer;
