#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shlobj.h>

extern int __argc;
extern wchar_t **__wargv;

static void delete_tree(const wchar_t *path) {
  wchar_t search[MAX_PATH];
  wsprintfW(search, L"%s\\*", path);
  WIN32_FIND_DATAW fd;
  HANDLE h = FindFirstFileW(search, &fd);
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
      wchar_t full[MAX_PATH];
      wsprintfW(full, L"%s\\%s", path, fd.cFileName);
      if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
        delete_tree(full);
      } else {
        DeleteFileW(full);
      }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
  }
  RemoveDirectoryW(path);
}

static void delete_shortcuts(void) {
  wchar_t folder[MAX_PATH];
  wchar_t path[MAX_PATH];
  if (SHGetFolderPathW(NULL, CSIDL_DESKTOPDIRECTORY, NULL, SHGFP_TYPE_CURRENT, folder) == S_OK) {
    wsprintfW(path, L"%s\\DeepSeek Harness.lnk", folder);
    DeleteFileW(path);
  }
  if (SHGetFolderPathW(NULL, CSIDL_COMMON_PROGRAMS, NULL, SHGFP_TYPE_CURRENT, folder) == S_OK) {
    wsprintfW(path, L"%s\\DeepSeek Harness.lnk", folder);
    DeleteFileW(path);
  }
}

static void delete_registry(void) {
  RegDeleteTreeW(HKEY_LOCAL_MACHINE,
    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeepSeek Harness");
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrev, PWSTR pCmdLine, int nCmdShow) {
  (void)hInstance; (void)hPrev; (void)pCmdLine; (void)nCmdShow;
  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(NULL, exe, MAX_PATH);
  wchar_t dir[MAX_PATH];
  wcscpy_s(dir, MAX_PATH, exe);
  wchar_t *slash = wcsrchr(dir, L'\\');
  if (slash != NULL) *slash = L'\0';

  if (__argc > 1 && wcscmp(__wargv[1], L"--cleanup") == 0) {
    Sleep(1500);
    if (__argc > 2) delete_tree(__wargv[2]);
    return 0;
  }

  int result = MessageBoxW(NULL,
    L"\u786e\u5b9a\u8981\u5378\u8f7d DeepSeek Harness \u5417\uff1f\n\n\u5378\u8f7d\u5c06\u5220\u9664\u5b89\u88c5\u76ee\u5f55\u3001\u5feb\u6377\u65b9\u5f0f\u548c\u6ce8\u518c\u4fe1\u606f\u3002",
    L"DeepSeek Harness \u5378\u8f7d", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2);
  if (result != IDYES) return 0;

  delete_shortcuts();
  delete_registry();

  wchar_t temp[MAX_PATH];
  GetTempPathW(MAX_PATH, temp);
  wchar_t tmpExe[MAX_PATH];
  wsprintfW(tmpExe, L"%s\\dsh-uninstaller-tmp.exe", temp);
  CopyFileW(exe, tmpExe, FALSE);

  wchar_t command[MAX_PATH * 2 + 64];
  wsprintfW(command, L"\"%s\" --cleanup \"%s\"", tmpExe, dir);
  STARTUPINFOW si;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  PROCESS_INFORMATION pi;
  ZeroMemory(&pi, sizeof(pi));
  CreateProcessW(NULL, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
  if (pi.hProcess != NULL) CloseHandle(pi.hProcess);
  if (pi.hThread != NULL) CloseHandle(pi.hThread);
  return 0;
}