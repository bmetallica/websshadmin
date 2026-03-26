const config = require('../config');

let ldap;
try {
  ldap = require('ldapjs');
} catch {
  // ldapjs is optional - only needed when AD_ENABLED=true
}

function authenticateAD(username, password) {
  return new Promise((resolve) => {
    if (!ldap) {
      return resolve({ success: false, error: 'ldapjs nicht installiert' });
    }

    if (!config.ad.url || !config.ad.baseDN) {
      return resolve({ success: false, error: 'AD-Konfiguration unvollstaendig' });
    }

    const client = ldap.createClient({
      url: config.ad.url,
      connectTimeout: 10000,
      timeout: 10000,
    });

    client.on('error', (err) => {
      resolve({ success: false, error: `LDAP-Verbindungsfehler: ${err.message}` });
    });

    // Step 1: Bind with service account
    client.bind(config.ad.bindDN, config.ad.bindPassword, (err) => {
      if (err) {
        client.destroy();
        return resolve({ success: false, error: `Service-Bind fehlgeschlagen: ${err.message}` });
      }

      // Step 2: Search for user
      const userFilter = config.ad.userFilter.replace(/\{\{username\}\}/g, ldap.filters.escapeFilter(username));
      const searchOpts = {
        scope: 'sub',
        filter: userFilter,
        attributes: ['dn', 'sAMAccountName', 'memberOf', 'displayName'],
      };

      client.search(config.ad.baseDN, searchOpts, (err, searchRes) => {
        if (err) {
          client.destroy();
          return resolve({ success: false, error: `Benutzersuche fehlgeschlagen: ${err.message}` });
        }

        let userEntry = null;

        searchRes.on('searchEntry', (entry) => {
          userEntry = {
            dn: typeof entry.dn === 'string' ? entry.dn : entry.dn.toString(),
            attributes: {},
          };
          // Extract attributes
          if (entry.pojo && entry.pojo.attributes) {
            for (const attr of entry.pojo.attributes) {
              userEntry.attributes[attr.type] = attr.values;
            }
          }
        });

        searchRes.on('error', (err) => {
          client.destroy();
          resolve({ success: false, error: `Suchfehler: ${err.message}` });
        });

        searchRes.on('end', () => {
          if (!userEntry) {
            client.destroy();
            return resolve({ success: false, error: 'Benutzer nicht gefunden' });
          }

          // Step 3: Bind as user to verify password
          const userClient = ldap.createClient({
            url: config.ad.url,
            connectTimeout: 10000,
            timeout: 10000,
          });

          userClient.on('error', () => {
            client.destroy();
            resolve({ success: false, error: 'Authentifizierung fehlgeschlagen' });
          });

          userClient.bind(userEntry.dn, password, (err) => {
            userClient.destroy();

            if (err) {
              client.destroy();
              return resolve({ success: false, error: 'Ungueltige Anmeldedaten' });
            }

            // Step 4: Extract groups
            const memberOf = userEntry.attributes.memberOf || [];
            const adGroups = memberOf.map(dn => {
              const match = dn.match(/^CN=([^,]+)/i);
              return match ? match[1] : dn;
            });

            // Map AD groups to app groups
            const appGroups = [];
            for (const adGroup of adGroups) {
              if (config.ad.groupMap[adGroup]) {
                appGroups.push(config.ad.groupMap[adGroup]);
              }
            }

            // Determine role
            let role = config.ad.defaultRole;
            for (const adGroup of adGroups) {
              if (config.ad.adminGroups.includes(adGroup)) {
                role = 'admin';
                break;
              }
            }

            client.destroy();
            resolve({
              success: true,
              username,
              role,
              groups: appGroups,
              adGroups,
            });
          });
        });
      });
    });
  });
}

module.exports = { authenticateAD };
