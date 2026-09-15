@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 睡眠中控
echo   本机 http://127.0.0.1:8792/
echo   局域网地址会在下方打印；防火墙若询问，允许一次。
start "" "http://127.0.0.1:8792/"
python server.py
pause
