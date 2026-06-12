@echo off
git add .
git commit -m "Backup: %date% %time%"
git push
pause
