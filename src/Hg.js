const ShortID = require('shortid');
const Path = require('path');
const Tempy = require('tempy');
const Globby = require('globby');
const HgRepo = require('./HgRepo');
const Command = require('./Command');
const Utils = require('./Utils');

async function getSourceInfo(source) {
  let sourceRepoPath;
  let sourceRepoName;
  let sourceURL = null;
  let tmpRepo = null;

  if (source.constructor !== String || source.constructor !== Object) {
    throw new TypeError('Incorrect type of from parameter. Clone source in the array is an invalid type. Must be an String or an Object');
  }

  if (source.constructor === Object) sourceURL = source.url;
  if (source.constructor === String) sourceURL = source;

  if (new URL(sourceURL).hostname) {
    const tmpDir = Tempy.directory;

    tmpRepo = await cloneSingle(source, { path: tmpDir, url: sourceURL });
    sourceRepoPath = tmpRepo.path;
    sourceRepoName = tmpRepo.name;
  } else {
    sourceRepoPath = source;
    sourceRepoName = Path.basename(source);
  }

  return sourceRepoName , sourceRepoPath;
}

async function cloneSingle(from, to, pythonPath) {
  let repo;
  let url;

  if (from.constructor === Object) {
    repo = new HgRepo(to || {
      url: from.url,
      password: from.password,
      username: from.username,
    }, pythonPath);

    url = Utils.buildRepoURL(from);
  } else {
    repo = new HgRepo(to || {
      url: from,
    }, pythonPath);
    url = from;
  }

  await Command.run('hg clone', repo.path, [url, repo.path]);

  return repo;
}

async function cloneMultipleAndMerge(fromRepos, combinedRepo) {
  const mergedRepos = [];

  for (let repo of fromRepos) {
    const [repoName, repoPath] = getSourceInfo(repo);
    let repoDir;

    if (mergedRepos.includes(repoName)) {
      repoDir += `-${ShortID.generate()}`;
    } else {
      repoDir = repoName;
    }

    await combinedRepo.pull({ source: repoPath, force: true });
    await combinedRepo.update({ clean: true, revision: 'default' });

    const files = await Globby(['*', '!.hg'], { dot: true, cwd: combinedRepo.path });

    await Utils.moveFiles(combinedRepo.path, Path.join(combinedRepo.path, repoName), files);
    await combinedRepo.add();

    try {
      await combinedRepo.remove({ after: true });
    } catch (errorInfo) {
      if (!errorInfo.error.message.includes('still exists')) throw errorInfo.error;
    }

    await combinedRepo.commit(`Moving repository ${repoName} into folder ${repoDir}`);

    if (!mergedRepos.length) break;

    await combinedRepo.merge();

    try {
      await combinedRepo.commit(`Merging ${repoName} into combined`);
    } catch (errorInfo) {
      if (!errorInfo.error.message.includes('nothing to merge') &&
        !errorInfo.error.message.includes('merging with a working directory ancestor')) {
        throw errorInfo.error;
      }
    }

    mergedRepos.push(repoName);
  }

  return combinedRepo;
}

class Hg {
  constructor(path = 'python') {
    this.pythonPath = path;
  }

  async clone(from, to = undefined, done = undefined) {
    let repo;

    try {
      switch (from.constructor) {
        case Array:
          {
            repo = await cloneMultipleAndMerge(from, to);
            break;
          }
        case String || Object:
          repo = await cloneSingle(from, to, this.pythonPath);
          break;
        default:
          return new TypeError('Incorrect type of from parameter. Must be an array or an object');
      }
    } catch (e) {
      if (e.message.includes('not found')) {
        throw new TypeError('Incorrect type of from parameter. Clone source not found');
      } else {
        throw e;
      }
    }

    return Utils.asCallback(repo, done);
  }

  async create(to, done = undefined) {
    const repo = new HgRepo(to, this.pythonPath);

    await repo.init();

    return Utils.asCallback(repo, done);
  }

  async gitify({ gitRepoPath = undefined } = {}, done = undefined) {
    const repo = new HgRepo(undefined, this.pythonPath);

    await repo.gitify({ gitRepoPath });

    return Utils.asCallback(null, done);
  }

  version(done = undefined) {
    return this.constructor.version(done);
  }

  static async version(done = undefined) {
    const output = await Command.run('hg --version');

    return Utils.asCallback(output, done);
  }
}

module.exports = Hg;
