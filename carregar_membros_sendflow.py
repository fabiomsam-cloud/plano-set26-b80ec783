#!/usr/bin/env python3
# Carrega no painel do Plano a lista de membros dos grupos do Estude Comigo exportada da Sendflow.
# Uso: exporte na Sendflow (Campanha → Exportar leads) para ~/Downloads como "SENDFLOW TJ-AM.csv",
#      "SENDFLOW SEDUC-AM.csv", "SENDFLOW SEDUC-PA.csv" (opcionais: "SENDFLOW POLICIAS.csv", "SENDFLOW PRF.csv")
#      e rode: python3 "PLANO 2026/painel/carregar_membros_sendflow.py"
import csv, re, json, os, sys, urllib.request
API = "https://dqpxugdhlgafvddavzzp.supabase.co/functions/v1/dashboard-plano?k=plano-sou-758a5e2b&resource=membros"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcHh1Z2RobGdhZnZkZGF2enpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxODQ1NTMsImV4cCI6MjA5Nzc2MDU1M30.nUhYPO3oLUZEXgQCDlRtL-Jawi0nr0l1Z7_z5ecEXvc"
ARQS = {"TJAM": "SENDFLOW TJ-AM.csv", "SEDUC_AM": "SENDFLOW SEDUC-AM.csv", "SEDUC_PA": "SENDFLOW SEDUC-PA.csv",
        "POLICIAS": "SENDFLOW POLICIAS.csv", "PRF": "SENDFLOW PRF.csv"}
base = os.path.expanduser("~/Downloads")
for frente, nome in ARQS.items():
    path = os.path.join(base, nome)
    if not os.path.exists(path): continue
    rows = list(csv.reader(open(path, encoding="utf-8-sig"), delimiter=";"))
    membros = []
    for r in rows[1:]:
        if len(r) < 5: continue
        num = re.sub(r"\D", "", r[3])
        if num: membros.append({"numero": num, "saiu": r[4].strip().lower() == "sim"})
    req = urllib.request.Request(API, data=json.dumps({"frente": frente, "membros": membros}).encode(), method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + ANON, "apikey": ANON})
    try:
        print(frente, nome, "→", urllib.request.urlopen(req, timeout=120).read().decode()[:200])
    except Exception as e:
        print(frente, nome, "ERRO", e, getattr(e, "read", lambda: b"")().decode()[:300]); sys.exit(1)
