"use strict";
const os = require('os');
const fs = require('fs');
const baqend = require('../lib/baqend');
const fileName = os.homedir() + '/.baqend';
const readline = require('readline');
const crypto = require('crypto');
const opn = require('opn');
const algorithm = 'aes-256-ctr';
const password = 'N2Ki=za[8iy4ff4jYn/3,y;';

const bbqHost = 'bbq';
let host;
let app;

function login(args, persist) {
  if (args.host && args.app) {
    throw new Error('Only app or host parameter is allowed.');
  }
  host = args.host || bbqHost;
  app = args.app;

  let inputPromise;
  if (args.username && args.password) {
    inputPromise = Promise.resolve([args.username, args.password]);
  } else if (persist) {
    showLoginInfo();
    inputPromise = readInputCredentials();
  } else {
    inputPromise = readFile().then((json) => {
      if (json[host] && json[host].password && json[host].username) {
        return [json[host].username, json[host].password];
      } else {
        console.log('Baqend Login is required. You can skip this step by saving the Login credentials with "baqend login"');
        showLoginInfo();
        return readInputCredentials();
      }
    });
  }

  return inputPromise.then((credentials) => {
    return dbLogin(credentials[0], credentials[1]).then((db) => [credentials, db]);
  }).then((args) => {
    let credentials = args[0];
    let db = args[1];
    if (persist) {
      return saveCredentials(credentials[0], credentials[1]);
    }
    return db;
  });
}

module.exports.login = login;

module.exports.register = function() {
  host = bbqHost;
  return readInputCredentials().then(credentials => {
    return register(credentials[0], credentials[1]).then(db => {
      loadAppName(db).then(name => console.log('Your app name is ' + name));
      return saveCredentials(credentials[0], credentials[1]);
    });
  }).catch(e => console.log(e.message || e));
};

module.exports.logout = function(args) {
  host = args.host || bbqHost;

  return readFile().then((json) => {
    delete json[host];
    return writeFile(json);
  });
};

module.exports.openApp = function(app) {
  if (app) {
    opn(`https://${app}.app.baqend.com`)
  } else {
    return login({}, false).then(db => {
      opn(`https://${db._connector.host}`);
    }).catch(e => console.log(e.message || e));
  }
};

module.exports.openDashboard = function() {
  host = 'bbq';
  return readFile().then(json => {
    if (json[host] && json[host].password && json[host].username) {
      connect(host, json[host].username, json[host].password).then(db => {
        opn("https://dashboard.baqend.com/login?token=" + db.token);
      });
    } else {
      opn("https://dashboard.baqend.com");
    }
  })
};

function getDefaultApp(db) {
  return db.modules.get('apps').then(apps => {
    if (apps.length === 1) {
      return apps[0].name;
    }
    throw new Error('Please add the name of your app as a parameter.');
  });
};

function showLoginInfo() {
  console.log('If you have created your Baqend Account with OAuth:');
  console.log(' 1. Login to the dashboard with OAuth.');
  console.log(' 2. Go to your account settings (top right corner)');
  console.log(' 3. Add a password to your account, which you can then use with the CLI.');
  console.log('');
}

function readInputCredentials() {
  return readInput('E-Mail: ')
      .then((username) => {
        return readInput('Password: ', true).then((password) => {
          console.log();
          return [username, password];
        });
      });
}

function encrypt(input) {
  let cipher = crypto.createCipher(algorithm, password);
  let encrypted = cipher.update(input, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function decrypt(input) {
  let decipher = crypto.createDecipher(algorithm, password);
  let decrypted = decipher.update(input, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function readInput(question, hidden) {
  let Writable = require('stream').Writable;

  let mutableStdout = new Writable({
    write: function(chunk, encoding, callback) {
      if (!this.muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    }
  });

  let rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  });

  return new Promise((resolve, reject) => {
    mutableStdout.muted = false;
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    mutableStdout.muted = hidden;
  });
}

function writeFile(json) {
  return new Promise((resolve, reject) => {
    fs.writeFile(fileName, JSON.stringify(json), function(err) {
      if (err) {
        reject(err)
      }
      resolve();
    });
  });
}

function readFile() {
  return new Promise((resolve, reject) => {
    fs.readFile(fileName, function(err, data) {
      let json = data ? JSON.parse(data.toString()) : {};
      if (json[host] && json[host].password) {
        json[host].password = decrypt(json[host].password);
      }

      resolve(json);
    });
  })
}

function saveCredentials(username, password) {
  return readFile().then((json) => {
    json[host] = json[host] || {};
    json[host].username = username;
    json[host].password = encrypt(password);
    return writeFile(json);
  })
}

function connect(hostName, username, password) {
  return baqend.connect(hostName, true)
      .then(db => db.login(username, password).then(() => db))
}

function dbLogin(username, password) {
  return connect(host, username, password)
      .then(db => {
        if (isBbq()) {
          return app? bbqAppLogin(db) : getDefaultApp(db).then(appName => bbqAppLogin(db, appName));
        }
        return db;
      });
}

function register(username, password) {
  return baqend.connect(host, true)
      .then(db => {
        return db.User.register(username, password).then(() => db)
      });
}

function loadAppName(db) {
  return db.modules.get('apps').then(apps => apps[0].name);
}

function bbqAppLogin(db, appName) {
  return db.modules.get('apps', { app: app || appName }).then((result) => {
    if (!result) {
      throw new Error('App not found.');
    }

    let factory = new baqend.EntityManagerFactory({host: result.name, secure: true, tokenStorageFactory: {
      create(origin) {
        return new baqend.util.TokenStorage(origin, result.token);
      }
    }});
    return factory.createEntityManager(true).ready();
  })
}

function isBbq() {
  return host === bbqHost;
}