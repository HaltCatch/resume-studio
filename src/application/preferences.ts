export const loadPreference = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export const savePreference = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 偏好保存失败不影响简历数据。
  }
};
