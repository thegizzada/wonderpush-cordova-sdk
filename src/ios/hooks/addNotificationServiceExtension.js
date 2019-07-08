const fs = require('fs-extra');
const path = require('path');
const ContextHelper = require('./ContextHelper');
const ProjectHelper = require('./ProjectHelper');
const LogHelper = require('./LogHelper');

const EXTENSION_TARGET_BUILD_SETTINGS = {
  Debug: {
    DEBUG_INFORMATION_FORMAT: 'dwarf',
    GCC_DYNAMIC_NO_PIC: 'NO',
    GCC_OPTIMIZATION_LEVEL:  0,
    GCC_PREPROCESSOR_DEFINITIONS: "(\n          \"DEBUG=1\",\n          \"$(inherited)\",\n        )",
    MTL_ENABLE_DEBUG_INFO: 'INCLUDE_SOURCE',
  },
  Release: {
    DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
    ENABLE_NS_ASSERTIONS: 'NO',
    MTL_ENABLE_DEBUG_INFO: 'NO',
    VALIDATE_PRODUCT: 'YES',
  },
  Common: {
    ALWAYS_SEARCH_USER_PATHS: 'NO',
    CLANG_ANALYZER_NONNULL: 'YES',
    CLANG_ANALYZER_NUMBER_OBJECT_CONVERSION: 'YES_AGGRESSIVE',
    CLANG_CXX_LANGUAGE_STANDARD: '"gnu++14"',
    CLANG_CXX_LIBRARY: '"libc++"',
    CLANG_ENABLE_OBJC_WEAK: 'YES',
    CLANG_WARN_DIRECT_OBJC_ISA_USAGE: 'YES_ERROR',
    CLANG_WARN_DOCUMENTATION_COMMENTS: 'YES',
    CLANG_WARN_OBJC_ROOT_CLASS: 'YES_ERROR',
    CLANG_WARN_UNGUARDED_AVAILABILITY: 'YES_AGGRESSIVE',
    COPY_PHASE_STRIP: 'NO',
    GCC_C_LANGUAGE_STANDARD: 'gnu11',
    GCC_WARN_ABOUT_RETURN_TYPE: 'YES_ERROR',
    GCC_WARN_UNINITIALIZED_AUTOS: 'YES_AGGRESSIVE',
    IPHONEOS_DEPLOYMENT_TARGET: '10.0',
    MTL_ENABLE_DEBUG_INFO: 'NO',
    MTL_FAST_MATH: 'YES',
    SKIP_INSTALL: 'YES',
    TARGETED_DEVICE_FAMILY: '"1,2"',
  },
};

/**
 * Make sure our notification service extension has the right product bundle identifier.
 * This identifier might change when user updates the identifier of his app in config.xml
 * or when Cordova prepare wrongly mistakes our build configuration for the project's.
 * @param contextHelper
 * @param projectHelper
 */
const ensureProductBundleIdentifier = (contextHelper, projectHelper) => {

  const logHelper = new LogHelper(contextHelper.context);
  let mustSave = false;
  for (const environment of ['Debug', 'Release']) {
    const appBundleIdentifier = projectHelper.getAppBundleIdentifier(environment);
    if (!appBundleIdentifier) {
      logHelper.debug('[ensureProductBundleIdentifier] Could not determine bundle ID');
      return;
    }
    const buildConfigurations = projectHelper.getAllBuildConfigurations()
      .filter(x =>
        x.pbxXCBuildConfiguration.name === environment
        && x.pbxXCBuildConfiguration.buildSettings.PRODUCT_NAME === ProjectHelper.NOTIFICATION_SERVICE_EXTENSION_NAME);

    for (const buildConfig of buildConfigurations) {
      const desiredBundleId = `${appBundleIdentifier }.${ProjectHelper.NOTIFICATION_SERVICE_EXTENSION_NAME}`;
      const actualBundleId = buildConfig.pbxXCBuildConfiguration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
      if (desiredBundleId !== actualBundleId) {
        logHelper.debug('[ensureProductBundleIdentifier] Updating notification service extension bundle ID to', desiredBundleId);
        mustSave = true;
        buildConfig.pbxXCBuildConfiguration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = desiredBundleId;
      }
    }
  }

  if (mustSave) {
    projectHelper.saveSync();
  }
  return Promise.resolve();
};
const addExtensionToProject = (contextHelper, project) => {
  const logHelper = new LogHelper(contextHelper.context);
  logHelper.debug('[addExtensionToProject]');
  const pluginDir = contextHelper.pluginDir;
  const projectRoot = contextHelper.projectRoot;
  if (!pluginDir || !projectRoot) return Promise.resolve();

  const ourServiceExtensionName = ProjectHelper.NOTIFICATION_SERVICE_EXTENSION_NAME;
  const projectHelper = new ProjectHelper(project);
  const existingServiceExtensions = projectHelper.getAppExtensionTargets();

  // Message user if another extension that is not ours is found
  if (existingServiceExtensions.find(x => x.name !== ourServiceExtensionName)) logHelper.warn('You already have a notification service extension. Please follow our guide to support rich push notifications: https://docs.wonderpush.com/docs/adding-a-notification-service-extension');

  // Exit right there
  if (existingServiceExtensions.length) {
    logHelper.debug('[addExtensionToProject] existing service extension, exiting');
    return ensureProductBundleIdentifier(contextHelper, projectHelper);
  }

  // Copy files
  const source = path.join(pluginDir, 'src', 'ios', ourServiceExtensionName);
  const destination = path.join(projectRoot, 'platforms', 'ios', ourServiceExtensionName);

  logHelper.debug('[addExtensionToProject] copying ', source, 'to', destination);
  let extensionBundleIdentifier;

  return fs.copy(source, destination)
    .then(() => {

      // Let's add the extension
      logHelper.debug('[addExtensionToProject] create target', ourServiceExtensionName);
      const target = project.addTarget(ourServiceExtensionName, 'app_extension', ourServiceExtensionName);

      // Get this build configurations for the app
      const appTargetKey = projectHelper.getAppTargetKey();
      const appBuildConfigurations = projectHelper.getTargetBuildConfigurations(appTargetKey);

      // Get the build configuration for the extension
      const buildConfigurations = projectHelper.getTargetBuildConfigurations(target.uuid);
      for (const buildConfiguration of buildConfigurations) {
        logHelper.debug('[addExtensionToProject] update build configuration', buildConfiguration.uuid);

        const environment = buildConfiguration.pbxXCBuildConfiguration.name;

        // Copy CODE_SIGN* entries
        const correspondingAppBuildConfiguration = appBuildConfigurations.find(x => x.pbxXCBuildConfiguration.name === environment);
        if (correspondingAppBuildConfiguration && correspondingAppBuildConfiguration.pbxXCBuildConfiguration.buildSettings) {
          for (const key in correspondingAppBuildConfiguration.pbxXCBuildConfiguration.buildSettings) {
            if (key.startsWith("CODE_SIGN") || key === 'DEVELOPMENT_TEAM') {
              logHelper.debug('Copying build setting', key, correspondingAppBuildConfiguration.pbxXCBuildConfiguration.buildSettings[key]);
              buildConfiguration.pbxXCBuildConfiguration.buildSettings[key] = correspondingAppBuildConfiguration.pbxXCBuildConfiguration.buildSettings[key];
            }
          }
        }

        // Copy other build settings
        Object.assign(buildConfiguration.pbxXCBuildConfiguration.buildSettings, EXTENSION_TARGET_BUILD_SETTINGS.Common);
        Object.assign(buildConfiguration.pbxXCBuildConfiguration.buildSettings, EXTENSION_TARGET_BUILD_SETTINGS[environment]);

        // Copy bundle identifier
        const bundleIdentifier = projectHelper.getAppBundleIdentifier(environment);
        extensionBundleIdentifier = `${bundleIdentifier}.${ourServiceExtensionName}`;
        buildConfiguration.pbxXCBuildConfiguration.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = extensionBundleIdentifier;
      }

      // Create our group
      const filePaths = ['NotificationService.m', 'NotificationService.h', `${ourServiceExtensionName}-Info.plist`];
      const group = project.addPbxGroup(filePaths, ourServiceExtensionName, ourServiceExtensionName);
      logHelper.debug('[addExtensionToProject] created group', group.uuid);

      // Add our group to the main group
      const mainGroupId = projectHelper.getProjectMainGroupId();
      if (!mainGroupId) throw  new Error('Could not find main group ID');
      project.addToPbxGroup(group.uuid, mainGroupId);
      logHelper.debug('[addExtensionToProject] added group', group.uuid, 'to the main group', mainGroupId);

      // Only .m files
      const buildPhaseFileKeys = group.pbxGroup.children
        .filter(x => {
          const f = projectHelper.getFileByKey(x.value);
          return f && f.path && projectHelper.unquote(f.path).endsWith('.m');
        })
        .map(x => x.value);

      // Add build phase to compile files
      const buildPhase = projectHelper.addSourcesBuildPhase(buildPhaseFileKeys, target);
      logHelper.debug('[addExtensionToProject] added build phase', buildPhase.uuid);

      // Write the project
      projectHelper.saveSync();
      logHelper.debug('[addExtensionToProject] saved project');

      // Read the Podfile
      logHelper.debug('[addExtensionToProject] read Podfile', contextHelper.podfilePath);
      return fs.readFile(contextHelper.podfilePath);
    })
    .then((buffer) => {
      const podfileContents = buffer.toString('utf8');
      if (podfileContents.indexOf(ProjectHelper.PODFILE_SNIPPET) < 0) {
        logHelper.debug('[addExtensionToProject] adding snippet to Podfile', contextHelper.podfilePath);
        return fs.writeFile(contextHelper.podfilePath, podfileContents + "\n" + ProjectHelper.PODFILE_SNIPPET)
          .then(() => contextHelper.runPodInstall());
      }
    })
    .then(() => {
      logHelper.log('Notification service extension added with bundle identifier', extensionBundleIdentifier);
      logHelper.warn('Please reload your Xcode workspace.');
    });
};

module.exports = function(context) {
  const contextHelper = new ContextHelper(context);

  return contextHelper.readConfig()
    .then((config) => {
      return contextHelper.readXcodeProject()
        .catch((err) => { /* ignore, platform iOS might not be supported */ })
        .then((project) => (project ? addExtensionToProject(contextHelper, project) : null));
    })
    .catch((err) => console.error(err))
};
