import { describe, expect, it } from 'vitest';
import {
  cmeError,
  csqRssi,
  decodeImei,
  decodeLog,
  dottedToIpv6,
  eutranCell,
  EXAMPLE_LOG,
  luhnValid,
  measRange,
  splitParams,
  CESQ_PARAMS,
} from '../src/lib/at-decoder';
import { CME_EPS, CME_GENERAL, EMM_CAUSES } from '../src/lib/at-tables';

const one = (line: string) => {
  const d = decodeLog(line);
  expect(d).toHaveLength(1);
  return d[0];
};
const field = (d: ReturnType<typeof one>, name: string) => d.fields.find((f) => f.name === name);

describe('splitParams', () => {
  it('keeps commas inside quotes and parentheses', () => {
    expect(splitParams('1,"a,b",(1,2),,3')).toEqual([
      { value: '1', quoted: false },
      { value: 'a,b', quoted: true },
      { value: '(1,2)', quoted: false },
      { value: '', quoted: false },
      { value: '3', quoted: false },
    ]);
  });
});

describe('tables extracted from the spec', () => {
  it('spot checks against TS 27.007 §9.2 and TS 24.301 Table 9.9.3.9.1', () => {
    expect(CME_GENERAL[10]).toBe('SIM not inserted');
    expect(CME_GENERAL[30]).toBe('no network service');
    expect(CME_GENERAL[100]).toBe('unknown');
    expect(CME_EPS[111]).toBe('PLMN not allowed (#11)');
    expect(CME_EPS[127]).toBe('Missing or unknown APN (#27)');
    expect(EMM_CAUSES[15]).toBe('No Suitable Cells In tracking area');
    expect(EMM_CAUSES[22]).toBe('Congestion');
    expect(EMM_CAUSES[111]).toBe('Protocol error, unspecified');
    expect(Object.keys(EMM_CAUSES)).toHaveLength(41);
    for (const t of [CME_GENERAL, CME_EPS, EMM_CAUSES]) for (const v of Object.values(t)) expect(v).not.toMatch(/NOTE|\[\d+\]/);
  });
  it('cmeError falls through the tables', () => {
    expect(cmeError(3)).toEqual({ text: 'operation not allowed', domain: 'general' });
    expect(cmeError(148)?.domain).toBe('GPRS/UMTS');
    expect(cmeError(9999)).toBeNull();
  });
});

describe('measurement ranges (TS 27.007 §8.5, §8.69)', () => {
  const spec = (n: string) => CESQ_PARAMS.find((p) => p.name === n)!;
  const r = (name: string, n: number) => {
    const s = spec(name);
    return measRange(n, s.low1, s.step, s.max, s.unit, s.label, s.openTop ?? true);
  };
  it('RSRP', () => {
    expect(r('<rsrp>', 0)).toBe('RSRP < −140 dBm');
    expect(r('<rsrp>', 1)).toBe('−140 dBm ≤ RSRP < −139 dBm');
    expect(r('<rsrp>', 96)).toBe('−45 dBm ≤ RSRP < −44 dBm');
    expect(r('<rsrp>', 97)).toBe('RSRP ≥ −44 dBm');
    expect(r('<rsrp>', 98)).toBeNull();
  });
  it('RSRQ', () => {
    expect(r('<rsrq>', 0)).toBe('RSRQ < −19.5 dB');
    expect(r('<rsrq>', 1)).toBe('−19.5 dB ≤ RSRQ < −19 dB');
    expect(r('<rsrq>', 33)).toBe('−3.5 dB ≤ RSRQ < −3 dB');
    expect(r('<rsrq>', 34)).toBe('RSRQ ≥ −3 dB');
  });
  it('the other rows match the table end points', () => {
    expect(r('<rxlev>', 63)).toBe('RSSI ≥ −48 dBm');
    expect(r('<rscp>', 96)).toBe('RSCP ≥ −25 dBm');
    expect(r('<ecno>', 49)).toBe('Ec/Io ≥ 0 dB');
    expect(r('<ss_rsrq>', 126)).toBe('19.5 dB ≤ SS-RSRQ < 20 dB');
    expect(r('<ss_rsrp>', 126)).toBe('SS-RSRP ≥ −31 dBm');
    expect(r('<ss_sinr>', 127)).toBe('SS-SINR ≥ 40 dB');
    expect(r('<ss_sinr>', 1)).toBe('−23 dB ≤ SS-SINR < −22.5 dB');
  });
  it('+CSQ rssi', () => {
    expect(csqRssi(0)).toBe('−113 dBm or less');
    expect(csqRssi(1)).toBe('−111 dBm');
    expect(csqRssi(2)).toBe('−109 dBm');
    expect(csqRssi(30)).toBe('−53 dBm');
    expect(csqRssi(31)).toBe('−51 dBm or greater');
    expect(csqRssi(99)).toBe('not known or not detectable');
    expect(csqRssi(32)).toBeNull();
  });
});

describe('identifiers', () => {
  it('IMEI Luhn check (TS 27.007 example)', () => {
    expect(luhnValid('490154203237518')).toBe(true);
    expect(luhnValid('490154203237519')).toBe(false);
    expect(decodeImei('490154203237518').map((f) => f.value)).toEqual(['49015420', '323751', '8']);
  });
  it('E-UTRAN cell ID', () => {
    expect(eutranCell('01A2D101')).toBe('ECI 27447553 = eNB ID 107217, cell 1 (for a macro eNB)');
    expect(eutranCell('FFFFFFFF')).toMatch(/not a valid/);
  });
  it('IPv6 from dotted bytes', () => {
    expect(dottedToIpv6('32.1.13.184.0.0.0.0.0.0.0.0.0.0.0.1')).toBe('2001:db8::1');
    expect(dottedToIpv6('0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0')).toBe('::');
    expect(dottedToIpv6('1.2.3.4')).toBeNull();
  });
});

describe('+CEREG', () => {
  it('URC with PSM timers (n=4)', () => {
    const d = one('+CEREG: 1,"1A2D","01A2D101",7,,,"00000110","00101000"');
    expect(d.kind).toBe('urc');
    expect(d.tone).toBe('ok');
    expect(field(d, '<stat>')!.meaning).toBe('registered, home network');
    expect(field(d, '<tac>')!.meaning).toBe('tracking area code 6701 (decimal)');
    expect(field(d, '<AcT>')!.meaning).toMatch(/E-UTRAN/);
    expect(field(d, '<Active-Time>')!.meaning).toMatch(/= 12 s/);
    expect(field(d, '<Periodic-TAU>')!.meaning).toMatch(/= 8 h/);
  });
  it('read response is recognised by an unquoted second field', () => {
    const d = one('+CEREG: 5,1,"1A2D","01A2D101",9');
    expect(d.kind).toBe('response');
    expect(field(d, '<n>')!.meaning).toMatch(/plus EMM reject cause/);
    expect(field(d, '<AcT>')!.meaning).toMatch(/NB-IoT/);
  });
  it('read response from context', () => {
    const d = decodeLog('AT+CEREG?\n+CEREG: 2,0\nOK');
    expect(d[1].kind).toBe('response');
    expect(field(d[1], '<stat>')!.tone).toBe('bad');
  });
  it('URC before OK of a set command stays a URC', () => {
    const d = decodeLog('AT+CEREG=2\n+CEREG: 2\nOK');
    expect(d[1].kind).toBe('urc');
    expect(field(d[1], '<stat>')!.meaning).toMatch(/searching/);
  });
  it('reject cause', () => {
    const d = one('+CEREG: 3,"1A2D","01A2D101",7,0,15');
    expect(field(d, '<reject_cause>')!.meaning).toBe('#15 No Suitable Cells In tracking area');
    expect(d.notes.join(' ')).toMatch(/Registration denied/);
  });
});

describe('other responses', () => {
  it('+CESQ on LTE', () => {
    const d = decodeLog('AT+CESQ\n+CESQ: 99,99,255,255,22,41,255,255,255\nOK')[1];
    expect(d.fields.map((f) => f.name)).toEqual(['<rsrq>', '<rsrp>']);
    expect(field(d, '<rsrp>')!.meaning).toMatch(/−100 dBm ≤ RSRP < −99 dBm/);
    expect(field(d, '<rsrq>')!.meaning).toMatch(/−9 dB ≤ RSRQ < −8.5 dB/);
  });
  it('+COPS read and test', () => {
    const r = one('+COPS: 0,2,"20801",7');
    expect(field(r, '<oper>')!.meaning).toBe('MCC 208, MNC 01');
    const t = decodeLog('AT+COPS=?\n+COPS: (2,"Orange F","Orange","20801",7),(3,"SFR","SFR","20810",9),,(0,1,2,3,4),(0,1,2)')[1];
    expect(t.fields).toHaveLength(2);
    expect(t.fields[0].meaning).toBe('current; MCC 208, MNC 01; E-UTRAN (LTE, including LTE-M)');
    expect(t.fields[1].tone).toBe('bad');
  });
  it('+CSCON URC and read', () => {
    expect(one('+CSCON: 1').fields[0].meaning).toBe('connected');
    expect(one('+CSCON: 1,7,4').kind).toBe('urc');
    expect(one('+CSCON: 2,1').kind).toBe('response');
    const amb = one('+CSCON: 0,1');
    expect(amb.notes[0]).toMatch(/could also be a read response/);
    expect(decodeLog('AT+CSCON?\n+CSCON: 0,1')[1].kind).toBe('response');
  });
  it('+CEDRXRDP', () => {
    const d = one('+CEDRXRDP: 4,"0101","0010","0011"');
    expect(d.fields.map((f) => f.meaning)).toEqual([
      'E-UTRAN (WB-S1 mode), i.e. LTE-M',
      'eDRX cycle 81.92 s (1 min 21.92 s)',
      'eDRX cycle 20.48 s',
      'paging time window 5.12 s',
    ]);
    expect(d.notes.join(' ')).toMatch(/granted a different/);
  });
  it('+CEDRXP with NB-IoT reinterpretation', () => {
    const d = one('+CEDRXP: 5,"0100","0100","0001"');
    expect(d.kind).toBe('urc');
    expect(d.notes.join(' ')).toMatch(/interpreted as 0010/);
    expect(field(d, '<Paging_time_window>')!.meaning).toBe('paging time window 5.12 s');
  });
  it('+CPSMS read', () => {
    const d = one('+CPSMS: 1,,,"00111000","00100010"');
    expect(field(d, '<Requested_Periodic-TAU>')!.meaning).toMatch(/= 1 d/);
    expect(field(d, '<Requested_Active-Time>')!.meaning).toMatch(/= 2 min/);
  });
  it('+CCLK with time zone', () => {
    const d = one('+CCLK: "94/05/06,22:10:00+08"');
    expect(field(d, 'zz')!.meaning).toBe('time zone 8 quarter-hours = UTC+02:00');
    expect(field(d, 'UTC')!.value).toBe('1994-05-06T20:10:00Z');
    expect(field(one('+CCLK: "24/01/01,00:30:00-02"'), 'UTC')!.value).toBe('2024-01-01T01:00:00Z');
  });
  it('+CGPADDR with IPv6 bytes', () => {
    const d = one('+CGPADDR: 1,"10.0.0.1","32.1.13.184.0.0.0.0.0.0.0.0.0.0.0.1"');
    expect(d.fields[1].meaning).toBe('IPv4 address');
    expect(d.fields[2].meaning).toBe('IPv6 address 2001:db8::1');
  });
  it('+CGDCONT read', () => {
    const d = one('+CGDCONT: 1,"IPV4V6","","0.0.0.0",0,0,0,0');
    expect(field(d, '<PDP_type>')!.meaning).toBe('dual stack IPv4 and IPv6');
    expect(field(d, '<APN>')!.meaning).toMatch(/subscription default/);
    expect(field(d, '<IPv4AddrAlloc>')!.meaning).toMatch(/NAS signalling/);
  });
  it('+CGEV events', () => {
    expect(one('+CGEV: ME PDN ACT 1').fields[0].meaning).toBe('The module activated a PDN connection.');
    expect(one('+CGEV: NW DETACH').tone).toBe('bad');
    expect(one('+CGEV: NW DEACT "IP","10.0.0.1",1').fields[0].meaning).toBe('The network forced a context deactivation.');
    expect(one('+CGEV: NW ACT 1,2,1').fields[0].meaning).toMatch(/dedicated bearer/);
    expect(field(one('+CGEV: NW MODIFY 1,3,0'), '<change_reason>')!.meaning).toBe('TFT changed, QoS changed');
    expect(field(one('+CGEV: ME PDN ACT 1,0'), '<reason>')!.meaning).toBe('IPv4 only allowed');
  });
  it('errors and finals', () => {
    expect(one('+CME ERROR: 10').fields[0].meaning).toBe('SIM not inserted');
    expect(one('+CME ERROR: 127').fields[0].meaning).toBe('Missing or unknown APN (#27) (EPS)');
    expect(one('+CME ERROR: SIM not inserted').fields[0].meaning).toBe('verbose form of code 10');
    expect(one('+CME ERROR: 515').notes[0]).toMatch(/manufacturer-specific/);
    expect(one('OK').tone).toBe('ok');
    expect(one('ERROR').notes[0]).toMatch(/CMEE/);
  });
  it('IMEI and IMSI after a command', () => {
    const d = decodeLog('AT+CGSN\n490154203237518\nOK\nAT+CIMI\n208011234567890\nOK');
    expect(d[1].title).toBe('IMEI');
    expect(d[1].fields[2].tone).toBe('ok');
    expect(d[4].title).toBe('IMSI');
    expect(d[4].fields[0].value).toBe('208');
    expect(one('+CGSN: "490154203237518"').fields[0].value).toBe('49015420');
  });
});

describe('commands and log noise', () => {
  it('decodes set commands', () => {
    const d = one('AT+CPSMS=1,,,"00111000","00100010"');
    expect(d.kind).toBe('command');
    expect(d.title).toBe('Set: Power saving mode (PSM) setting');
    expect(field(d, '<mode>')!.meaning).toBe('PSM enabled');
    expect(one('AT+CEDRXS=2,4,"0010"').fields.map((f) => f.meaning)).toEqual([
      'enable eDRX and the +CEDRXP URC',
      'E-UTRAN (WB-S1 mode), i.e. LTE-M',
      'eDRX cycle 20.48 s',
    ]);
    expect(one('AT+CFUN=4').fields[0].meaning).toMatch(/flight mode/);
  });
  it('strips timestamps and direction markers', () => {
    expect(one('[12:00:01.123] +CSCON: 1').command).toBe('+CSCON');
    expect(one('12:00:01.123 > AT+CESQ').command).toBe('+CESQ');
    expect(one('<< +CEREG: 1').command).toBe('+CEREG');
  });
  it('flags vendor lines', () => {
    expect(one('%XMONITOR: 1,"Orange F"').title).toBe('Manufacturer-specific response');
    expect(one('AT%XSYSTEMMODE=1,0,0,0').notes[0]).toMatch(/vendor extensions/);
    expect(one('+QENG: "servingcell"').kind).toBe('unknown');
  });
  it('the example log decodes without unknown lines', () => {
    const d = decodeLog(EXAMPLE_LOG);
    expect(d.filter((x) => x.kind === 'unknown' || x.kind === 'info')).toEqual([]);
  });
});

describe('summarize', () => {
  it('collects the state at the end of the example log', async () => {
    const { summarize } = await import('../src/lib/at-decoder');
    const s = Object.fromEntries(summarize(decodeLog(EXAMPLE_LOG)).map((x) => [x.label, x.value]));
    expect(s).toEqual({
      Functionality: 'full functionality',
      Registration: 'registered, home network',
      'Access technology': 'E-UTRAN (LTE, including LTE-M)',
      Operator: '20801 (MCC 208, MNC 01)',
      Cell: 'TAC 1A2D, cell 01A2D101',
      Signal: '−100 dBm ≤ RSRP < −99 dBm; −9 dB ≤ RSRQ < −8.5 dB',
      'RRC connection': 'idle',
      'PSM granted': 'Active Time 12 s, periodic TAU 8 h',
      'eDRX granted': 'eDRX cycle 20.48 s, paging time window 5.12 s',
      'IP address': '10.160.34.17',
      'Last error': '3: operation not allowed',
    });
  });
});
