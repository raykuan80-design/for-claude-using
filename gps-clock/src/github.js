// GitHub REST API：打卡紀錄存在私人存放庫的 punches/ 資料夾，每個檔案一行或多行 CSV。
const API = 'https://api.github.com';

export const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
export const fromBase64 = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

export class GitHub {
  constructor({ owner, repo, branch, token }) {
    this.owner = owner.trim();
    this.repo = repo.trim();
    this.branch = (branch || '').trim();
    this.explicitBranch = !!this.branch; // 沒指定分支時寫入預設分支（空的存放庫也能直接寫）
    this.token = token.trim();
  }

  async request(method, path, body) {
    const res = await fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = {
        401: 'Token 無效或已過期',
        403: 'Token 沒有權限，或超過 API 次數限制',
        404: '找不到存放庫（檢查名稱，或 Token 沒有包含這個存放庫）',
      }[res.status] || (data && data.message) || `HTTP ${res.status}`;
      throw new GitHubError(res.status, msg);
    }
    return data;
  }

  /** 檢查連線，回傳存放庫資訊 { private, defaultBranch } */
  async info() {
    const r = await this.request('GET', '');
    if (!this.branch) this.branch = r.default_branch;
    return { private: r.private, defaultBranch: r.default_branch, canWrite: !!(r.permissions && r.permissions.push) };
  }

  async ensureBranch() { if (!this.branch) await this.info(); }

  /** 列出所有檔案 [{path, sha}]；空的存放庫回傳 [] */
  async listFiles() {
    await this.ensureBranch();
    try {
      const r = await this.request('GET', `/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
      return r.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha }));
    } catch (e) {
      if (e.status === 409 || e.status === 404) return []; // 空存放庫或分支不存在
      throw e;
    }
  }

  async getBlob(sha) {
    const r = await this.request('GET', `/git/blobs/${sha}`);
    return fromBase64(r.content);
  }

  /** 讀一個檔案，不存在時回傳 null */
  async getFile(path) {
    await this.ensureBranch();
    try {
      const r = await this.request('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
      return { text: fromBase64(r.content), sha: r.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** 新增或更新檔案（更新時要給 sha），回傳新的 blob sha */
  async putFile(path, text, message, sha) {
    const r = await this.request('PUT', `/contents/${encodePath(path)}`, {
      message, content: toBase64(text), ...(this.explicitBranch ? { branch: this.branch } : {}), ...(sha ? { sha } : {}),
    });
    return r.content.sha;
  }

  async deleteFile(path, sha, message) {
    await this.request('DELETE', `/contents/${encodePath(path)}`, { message, sha, ...(this.explicitBranch ? { branch: this.branch } : {}) });
  }
}
