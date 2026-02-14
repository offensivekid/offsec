// Admin Panel JavaScript
let currentPage = 0;
const SIEM_PER_PAGE = 50;

// ============= CURSOR GLOW =============
document.addEventListener('DOMContentLoaded', () => {
    const cursorGlow = document.querySelector('.cursor-glow');
    
    document.addEventListener('mousemove', (e) => {
        cursorGlow.style.transform = `translate(${e.clientX - 300}px, ${e.clientY - 300}px)`;
    });
    
    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loadingScreen').classList.add('hidden');
    }, 1000);
    
    // Load dashboard
    loadDashboard();
});

// ============= NAVIGATION =============
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    
    document.getElementById(sectionId).classList.add('active');
    
    // Find and activate the correct tab
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        if (tab.getAttribute('onclick') && tab.getAttribute('onclick').includes(sectionId)) {
            tab.classList.add('active');
        }
    });
    
    switch(sectionId) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'users':
            loadUsers();
            break;
        case 'content':
            loadThreads();
            break;
        case 'keys':
            loadKeys();
            break;
        case 'siem':
            loadSiem();
            break;
        case 'ipbans':
            loadIPBans();
            break;
    }
}

// ============= MODAL =============
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ============= DASHBOARD =============
async function loadDashboard() {
    try {
        const res = await fetch('/api/admin/stats');
        const stats = await res.json();
        
        document.getElementById('totalUsers').textContent = stats.users.total;
        document.getElementById('totalThreads').textContent = stats.threads.total;
        document.getElementById('totalReplies').textContent = stats.replies.total;
        document.getElementById('activeKeys').textContent = stats.keys.active;
        document.getElementById('bannedUsers').textContent = stats.users.banned;
        document.getElementById('siemCritical').textContent = stats.siem.critical;
        
        const siemRes = await fetch('/api/admin/siem?limit=10');
        const siemData = await siemRes.json();
        
        const container = document.getElementById('recentSiem');
        if (siemData.events.length === 0) {
            container.innerHTML = '<div class="empty-state">NO EVENTS</div>';
        } else {
            container.innerHTML = siemData.events.map(e => `
                <div class="log-entry ${e.severity}">
                    <div class="log-meta">
                        <span class="badge badge-${e.severity === 'critical' ? 'critical' : 'active'}">${e.severity.toUpperCase()}</span>
                        <span>${new Date(e.created_at).toLocaleString()}</span>
                        <span>${e.username || 'ANONYMOUS'}</span>
                        <span>${e.ip_address}</span>
                    </div>
                    <div class="log-type">${e.event_type}</div>
                    ${e.details ? `<div class="log-details"><code>${e.details}</code></div>` : ''}
                </div>
            `).join('');
        }
    } catch (err) {
        console.error('Dashboard error:', err);
        alert('Failed to load dashboard');
    }
}

// ============= USER MANAGEMENT =============
async function loadUsers() {
    try {
        const res = await fetch('/api/admin/users');
        const users = await res.json();
        
        const container = document.getElementById('usersTable');
        if (users.length === 0) {
            container.innerHTML = '<div class="empty-state">NO USERS</div>';
            return;
        }
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>USERNAME</th>
                        <th>EMAIL</th>
                        <th>ROLE</th>
                        <th>STATUS</th>
                        <th>THREADS</th>
                        <th>REPLIES</th>
                        <th>CREATED</th>
                        <th>ACTIONS</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(u => `
                        <tr>
                            <td>${u.id}</td>
                            <td>${u.username}</td>
                            <td>${u.email}</td>
                            <td>
                                ${u.is_admin ? '<span class="badge badge-admin">ADMIN</span>' : ''}
                                ${u.has_private_access ? '<span class="badge badge-active">PRIVATE</span>' : ''}
                            </td>
                            <td>
                                ${u.is_banned ? '<span class="badge badge-banned">BANNED</span>' : '<span class="badge badge-active">ACTIVE</span>'}
                            </td>
                            <td>${u.thread_count}</td>
                            <td>${u.reply_count}</td>
                            <td>${new Date(u.created_at).toLocaleDateString()}</td>
                            <td>
                                <button class="btn btn-small btn-secondary" onclick="editUserRole(${u.id}, ${u.is_admin}, ${u.has_private_access})">ROLE</button>
                                <button class="btn btn-small ${u.is_banned ? 'btn-secondary' : ''}" onclick="toggleBan(${u.id}, ${!u.is_banned})">${u.is_banned ? 'UNBAN' : 'BAN'}</button>
                                <button class="btn btn-small btn-danger" onclick="deleteUser(${u.id})">DEL</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Load users error:', err);
        alert('Failed to load users');
    }
}

async function createUser(event) {
    event.preventDefault();
    
    const data = {
        username: document.getElementById('newUsername').value,
        email: document.getElementById('newEmail').value,
        password: document.getElementById('newPassword').value,
        isAdmin: document.getElementById('newIsAdmin').checked,
        hasPrivateAccess: document.getElementById('newHasPrivateAccess').checked
    };
    
    try {
        const res = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (!res.ok) {
            alert(result.error || 'Failed to create user');
            return;
        }
        
        alert('User created successfully');
        closeModal('createUserModal');
        loadUsers();
        event.target.reset();
    } catch (err) {
        console.error('Create user error:', err);
        alert('Failed to create user');
    }
}

async function toggleBan(userId, isBanned) {
    if (!confirm(`Are you sure you want to ${isBanned ? 'ban' : 'unban'} this user?`)) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/users/${userId}/ban`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isBanned })
        });
        
        if (!res.ok) {
            alert('Failed to update ban status');
            return;
        }
        
        loadUsers();
    } catch (err) {
        console.error('Ban error:', err);
        alert('Failed to update ban status');
    }
}

async function editUserRole(userId, currentAdmin, currentPrivate) {
    const isAdmin = confirm('Should this user be an admin?');
    const hasPrivate = confirm('Should this user have private access?');
    
    try {
        const res = await fetch(`/api/admin/users/${userId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isAdmin, hasPrivateAccess: hasPrivate })
        });
        
        if (!res.ok) {
            alert('Failed to update role');
            return;
        }
        
        loadUsers();
    } catch (err) {
        console.error('Role update error:', err);
        alert('Failed to update role');
    }
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            const result = await res.json();
            alert(result.error || 'Failed to delete user');
            return;
        }
        
        loadUsers();
    } catch (err) {
        console.error('Delete user error:', err);
        alert('Failed to delete user');
    }
}

// ============= CONTENT MODERATION =============
async function loadThreads() {
    try {
        const res = await fetch('/api/admin/threads');
        const threads = await res.json();
        
        const container = document.getElementById('threadsTable');
        if (threads.length === 0) {
            container.innerHTML = '<div class="empty-state">NO THREADS</div>';
            return;
        }
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>TITLE</th>
                        <th>AUTHOR</th>
                        <th>TYPE</th>
                        <th>VIEWS</th>
                        <th>REPLIES</th>
                        <th>CREATED</th>
                        <th>ACTIONS</th>
                    </tr>
                </thead>
                <tbody>
                    ${threads.map(t => `
                        <tr>
                            <td>${t.id}</td>
                            <td>${t.title}</td>
                            <td>${t.author}</td>
                            <td>${t.is_private ? '<span class="badge badge-active">PRIVATE</span>' : '<span class="badge badge-inactive">PUBLIC</span>'}</td>
                            <td>${t.views}</td>
                            <td>${t.reply_count}</td>
                            <td>${new Date(t.created_at).toLocaleDateString()}</td>
                            <td>
                                <button class="btn btn-small btn-danger" onclick="deleteThread(${t.id})">DELETE</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Load threads error:', err);
        alert('Failed to load threads');
    }
}

async function deleteThread(threadId) {
    if (!confirm('Are you sure you want to delete this thread?')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/threads/${threadId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            alert('Failed to delete thread');
            return;
        }
        
        loadThreads();
    } catch (err) {
        console.error('Delete thread error:', err);
        alert('Failed to delete thread');
    }
}

// ============= ACCESS KEYS =============
async function loadKeys() {
    try {
        const res = await fetch('/api/admin/keys');
        const keys = await res.json();
        
        const container = document.getElementById('keysTable');
        if (keys.length === 0) {
            container.innerHTML = '<div class="empty-state">NO KEYS</div>';
            return;
        }
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>KEY</th>
                        <th>STATUS</th>
                        <th>CREATED BY</th>
                        <th>USED BY</th>
                        <th>CREATED</th>
                        <th>USED</th>
                        <th>ACTIONS</th>
                    </tr>
                </thead>
                <tbody>
                    ${keys.map(k => `
                        <tr>
                            <td><code>${k.key_code}</code></td>
                            <td>${k.is_active ? '<span class="badge badge-active">ACTIVE</span>' : '<span class="badge badge-inactive">USED</span>'}</td>
                            <td>${k.created_by_username || 'UNKNOWN'}</td>
                            <td>${k.used_by_username || '-'}</td>
                            <td>${new Date(k.created_at).toLocaleDateString()}</td>
                            <td>${k.used_at ? new Date(k.used_at).toLocaleDateString() : '-'}</td>
                            <td>
                                <button class="btn btn-small btn-danger" onclick="deleteKey(${k.id})">DELETE</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Load keys error:', err);
        alert('Failed to load keys');
    }
}

async function generateKeys() {
    const count = parseInt(document.getElementById('keyCount').value) || 1;
    
    if (count < 1 || count > 50) {
        alert('Count must be between 1 and 50');
        return;
    }
    
    try {
        const res = await fetch('/api/admin/keys/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count })
        });
        
        const result = await res.json();
        
        if (!res.ok) {
            alert(result.error || 'Failed to generate keys');
            return;
        }
        
        const container = document.getElementById('generatedKeys');
        container.innerHTML = `
            <div class="card" style="border-color: #2a2a2a; margin-bottom: 20px;">
                <div class="card-header" style="margin-bottom: 15px;">
                    <div class="card-title">GENERATED KEYS (${result.keys.length})</div>
                </div>
                ${result.keys.map(k => `
                    <div class="key-display">
                        <div class="key-code">${k}</div>
                        <button class="btn btn-small" onclick="copyToClipboard('${k}')">COPY</button>
                    </div>
                `).join('')}
            </div>
        `;
        
        loadKeys();
    } catch (err) {
        console.error('Generate keys error:', err);
        alert('Failed to generate keys');
    }
}

async function deleteKey(keyId) {
    if (!confirm('Are you sure you want to delete this key?')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/keys/${keyId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            alert('Failed to delete key');
            return;
        }
        
        loadKeys();
    } catch (err) {
        console.error('Delete key error:', err);
        alert('Failed to delete key');
    }
}

// ============= SIEM LOGS =============
async function loadSiem() {
    const severity = document.getElementById('severityFilter').value;
    const eventType = document.getElementById('eventTypeFilter').value;
    
    const params = new URLSearchParams({
        limit: SIEM_PER_PAGE,
        offset: currentPage * SIEM_PER_PAGE
    });
    
    if (severity) params.append('severity', severity);
    if (eventType) params.append('eventType', eventType);
    
    try {
        const res = await fetch(`/api/admin/siem?${params}`);
        const data = await res.json();
        
        const container = document.getElementById('siemLogs');
        if (data.events.length === 0) {
            container.innerHTML = '<div class="empty-state">NO EVENTS</div>';
            return;
        }
        
        container.innerHTML = data.events.map(e => {
            let details = '';
            try {
                const parsed = JSON.parse(e.details);
                details = Object.entries(parsed).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
            } catch {
                details = e.details;
            }
            
            return `
                <div class="log-entry ${e.severity}">
                    <div class="log-meta">
                        <span class="badge badge-${e.severity === 'critical' ? 'critical' : 'active'}">${e.severity.toUpperCase()}</span>
                        <span>${new Date(e.created_at).toLocaleString()}</span>
                        <span>USER: ${e.username || 'ANONYMOUS'} (ID: ${e.user_id || 'N/A'})</span>
                        <span>IP: ${e.ip_address}</span>
                    </div>
                    <div class="log-type">${e.event_type}</div>
                    <div class="log-details">
                        ENDPOINT: <code>${e.endpoint || 'N/A'}</code><br>
                        USER-AGENT: <code>${e.user_agent}</code><br>
                        ${details ? `DETAILS: <code>${details}</code>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        const totalPages = Math.ceil(data.total / SIEM_PER_PAGE);
        const pagination = document.getElementById('siemPagination');
        
        if (totalPages > 1) {
            let buttons = '';
            if (currentPage > 0) {
                buttons += `<button class="btn btn-secondary btn-small" onclick="changePage(${currentPage - 1})">PREV</button>`;
            }
            buttons += `<span style="padding: 10px;">PAGE ${currentPage + 1} OF ${totalPages}</span>`;
            if (currentPage < totalPages - 1) {
                buttons += `<button class="btn btn-secondary btn-small" onclick="changePage(${currentPage + 1})">NEXT</button>`;
            }
            pagination.innerHTML = buttons;
        } else {
            pagination.innerHTML = '';
        }
    } catch (err) {
        console.error('Load SIEM error:', err);
        alert('Failed to load SIEM logs');
    }
}

function changePage(page) {
    currentPage = page;
    loadSiem();
}

async function purgeSiem() {
    if (!confirm('This will delete logs older than 30 days. Continue?')) {
        return;
    }
    
    try {
        const res = await fetch('/api/admin/siem', {
            method: 'DELETE'
        });
        
        const result = await res.json();
        
        if (!res.ok) {
            alert('Failed to purge logs');
            return;
        }
        
        alert(`Deleted ${result.deleted} old logs`);
        loadSiem();
    } catch (err) {
        console.error('Purge SIEM error:', err);
        alert('Failed to purge logs');
    }
}

// ============= IP BANS =============
async function loadIPBans() {
    try {
        const res = await fetch('/api/admin/ipbans');
        const bans = await res.json();
        
        const container = document.getElementById('ipbansTable');
        if (bans.length === 0) {
            container.innerHTML = '<div class="empty-state">NO IP BANS</div>';
            return;
        }
        
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>IP ADDRESS</th>
                        <th>REASON</th>
                        <th>BANNED BY</th>
                        <th>CREATED</th>
                        <th>EXPIRES</th>
                        <th>ACTIONS</th>
                    </tr>
                </thead>
                <tbody>
                    ${bans.map(b => `
                        <tr>
                            <td><code>${b.ip_address}</code></td>
                            <td>${b.reason || 'NO REASON'}</td>
                            <td>${b.banned_by_username || 'SYSTEM'}</td>
                            <td>${new Date(b.created_at).toLocaleDateString()}</td>
                            <td>${b.expires_at ? new Date(b.expires_at).toLocaleDateString() : 'NEVER'}</td>
                            <td>
                                <button class="btn btn-small btn-secondary" onclick="deleteIPBan(${b.id})">UNBAN</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) {
        console.error('Load IP bans error:', err);
        alert('Failed to load IP bans');
    }
}

async function createIPBan(event) {
    event.preventDefault();
    
    const data = {
        ipAddress: document.getElementById('banIP').value,
        reason: document.getElementById('banReason').value,
        duration: document.getElementById('banDuration').value ? parseInt(document.getElementById('banDuration').value) : null
    };
    
    try {
        const res = await fetch('/api/admin/ipbans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await res.json();
        
        if (!res.ok) {
            alert(result.error || 'Failed to ban IP');
            return;
        }
        
        alert('IP banned successfully');
        closeModal('createBanModal');
        loadIPBans();
        event.target.reset();
    } catch (err) {
        console.error('Create IP ban error:', err);
        alert('Failed to ban IP');
    }
}

async function deleteIPBan(banId) {
    if (!confirm('Are you sure you want to remove this IP ban?')) {
        return;
    }
    
    try {
        const res = await fetch(`/api/admin/ipbans/${banId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            alert('Failed to remove ban');
            return;
        }
        
        loadIPBans();
    } catch (err) {
        console.error('Delete IP ban error:', err);
        alert('Failed to remove ban');
    }
}

// ============= SETTINGS =============
async function changePassword(event) {
    event.preventDefault();
    
    const current = document.getElementById('currentPassword').value;
    const newPass = document.getElementById('newPassword').value;
    
    try {
        const res = await fetch('/api/admin/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: current, newPassword: newPass })
        });
        
        const result = await res.json();
        
        if (!res.ok) {
            alert(result.error || 'Failed to change password');
            return;
        }
        
        alert('Password changed successfully');
        event.target.reset();
    } catch (err) {
        console.error('Change password error:', err);
        alert('Failed to change password');
    }
}

// ============= UTILITIES =============
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('COPIED TO CLIPBOARD');
    }).catch(err => {
        alert('FAILED TO COPY');
    });
}

async function logout() {
    if (!confirm('Are you sure you want to logout?')) {
        return;
    }
    
    try {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (err) {
        console.error('Logout error:', err);
        window.location.href = '/';
    }
}
