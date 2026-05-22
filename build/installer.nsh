; 标准盒子 NSIS 自定义安装/卸载脚本
; 卸载时可选保留资质数据库 ($INSTDIR\data)

!macro customUnInit
  ; 默认不保留
  StrCpy $R0 "0"

  ; 仅在交互式卸载（非静默）时弹窗询问
  IfSilent skip_prompt 0

  ; 检查是否存在 data 目录
  IfFileExists "$INSTDIR\data\*.*" 0 skip_prompt

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否保留资质数据？$\r$\n$\r$\n保留后，下次重新安装到同一目录可继续使用已订阅标准、CNAS / CMA 缓存等数据。$\r$\n$\r$\n选择“否”将彻底删除 $INSTDIR\data 目录。" \
    /SD IDYES IDYES keep_data IDNO skip_prompt

  keep_data:
    StrCpy $R0 "1"

  skip_prompt:
!macroend

!macro customRemoveFiles
  ; 若用户选择保留，先把 data 移到临时位置，等 NSIS 清完安装目录后再移回
  StrCmp $R0 "1" 0 normal_remove

  ; 备份到上级目录的 ._bzxz_data_backup
  Rename "$INSTDIR\data" "$INSTDIR\..\._bzxz_data_backup"

  ; 默认卸载流程：删除安装目录所有文件
  RMDir /r "$INSTDIR"

  ; 还原 data 目录
  CreateDirectory "$INSTDIR"
  Rename "$INSTDIR\..\._bzxz_data_backup" "$INSTDIR\data"

  Goto remove_done

  normal_remove:
    RMDir /r "$INSTDIR"

  remove_done:
!macroend
