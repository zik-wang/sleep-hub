@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 睡眠中控 · LD2410C 接入
echo.
echo 接线：雷达 5V-GND-TX/RX 交叉接到 USB-TTL，OUT 空着。
echo 灯带不要接到这块 TTL 上。电平跳帽若有，TX/RX 选 3.3V，电源仍用 5V。
echo 先关掉海凌科 Tool，串口不能两人抢。
echo.
echo 本机串口：
powershell -NoProfile -Command "try { $p = [System.IO.Ports.SerialPort]::GetPortNames(); if ($p) { $p } else { '（没有 COM 口，先插 USB-TTL）' } } catch { '读串口失败，去设备管理器看端口' }"
echo.
if not exist ".venv\Scripts\python.exe" (
  python -m pip show pyserial >nul 2>&1
  if errorlevel 1 (
    echo 正在安装 pyserial ...
    python -m pip install -r requirements.txt
  )
)
set /p PORT=COM口号（例如 COM4）: 
if "%PORT%"=="" (
  echo 没填口，退出。
  pause
  exit /b 1
)
echo 中控请先开着：双击 启动中控.bat
python plugins\ld2410c_presence.py --port %PORT%
pause
