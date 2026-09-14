#!/usr/bin/env python3
# Sincroniza a lista de membros dos grupos do Estude Comigo (export do conector Sendflow) com o painel do Plano.
# Uso: python3 sync_membros_sendflow.py FRENTE URL_CSV [URL_CSV ...]
#   FRENTE = TJAM | SEDUC_AM | SEDUC_PA | POLICIAS | PRF  (TJAM tem 2 releases → passar as 2 URLs de uma vez)
#   URL_CSV = "url" devolvida por export-leads-action (CSV "Posição;Grupo;Nome;Número[;Saiu]")
import csv, io, re, json, sys, urllib.request
API = "https://dqpxugdhlgafvddavzzp.supabase.co/functions/v1/dashboard-plano?k=plano-sou-758a5e2b&resource=membros"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcHh1Z2RobGdhZnZkZGF2enpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODQ1NTMsImV4cCI6MjA5Nzc2MDU1M30.nUhYPO3oLUZEXgQCDlRtL-Jawi0nr0l1Z7_z5ecEXvc"
if len(sys.argv) < 3: sys.exit("uso: sync_membros_sendflow.py FRENTE URL [URL...]")
frente, urls = sys.argv[1].upper(), sys.argv[2:]
membros, grupos = {}, set()
for u in urls:
    raw = urllib.request.urlopen(u, timeout=120).read().decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(raw), delimiter=";"))
    for r in rows[1:]:
        if len(r) < 4: continue
        num = re.sub(r"\D", "", r[3])
        if not num: continue
        grupos.add(r[1]); saiu = len(r) > 4 and r[4].strip().lower() == "sim"
        membros[num] = membros.get(num, False) or saiu
payload = {"frente": frente, "membros": [{"numero": n, "saiu": s} for n, s in membros.items()]}
req = urllib.request.Request(API, data=json.dumps(payload).encode(), method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + ANON, "apikey": ANON})
try:
    print(frente, f"{len(urls)} arquivo(s) · {len(grupos)} grupos · {len(membros)} números →", urllib.request.urlopen(req, timeout=120).read().decode()[:200])
except Exception as e:
    print(frente, "ERRO", e, getattr(e, "read", lambda: b"")().decode()[:300]); sys.exit(1)
