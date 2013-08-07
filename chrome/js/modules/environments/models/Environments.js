var Environments = Backbone.Collection.extend({
    model: Environment,

    isLoaded: false,
    initializedSyncing: false,

    comparator: function(a, b) {        
        var counter;

        var aName = a.get("name");
        var bName = b.get("name");

        if (aName.length > bName.legnth)
            counter = bName.length;
        else
            counter = aName.length;

        for (var i = 0; i < counter; i++) {
            if (aName[i] == bName[i]) {
                continue;
            } else if (aName[i] > bName[i]) {
                return 1;
            } else {
                return -1;
            }
        }
        return 1;
    },
    
    initialize:function () {
        var collection = this;
        
        this.startListeningForFileSystemSyncEvents();

        pm.indexedDB.environments.getAllEnvironments(function (environments) {
            collection.set("loaded", true);
            environments.sort(sortAlphabetical);
            collection.add(environments, {merge: true});            
            collection.isLoaded = true;
            collection.trigger("startSync");
        })
    },

    startListeningForFileSystemSyncEvents: function() {
        var collection = this;
        var isLoaded = collection.isLoaded;
        var initializedSyncing = collection.initializedSyncing;

        pm.mediator.on("initializedSyncableFileSystem", function() {
            collection.initializedSyncing = true;
            collection.trigger("startSync");
        });

        this.on("startSync", this.startSyncingEnvironments, this);
    },

    startSyncingEnvironments: function() {        
        var i = 0;
        var collection = this;
        var environment;
        var synced;
        var syncableFile;

        console.log("Start syncing environments");

        if (this.isLoaded && this.initializedSyncing) {
            pm.mediator.on("syncableFileStatusChanged", function(detail) {
                console.log("File status changed", detail);                
                var direction = detail.direction;
                var action = detail.action;
                var name = detail.fileEntry.name;
                var status = detail.status;
                var s = splitSyncableFilename(name);

                var id = s.id;
                var type = s.type;

                var addReceiver = _.bind(collection.onReceivingSyncableFileData, collection);
                var updateReceiver = _.bind(collection.onReceivingSyncableFileData, collection);
                var removeReceiver = _.bind(collection.onRemoveSyncableFile, collection);

                if (type === "environment") {
                    if (status === "synced") {
                        if (direction === "remote_to_local") {
                            if (action === "added") {
                                console.log("Add local file to environment", id);
                                pm.mediator.trigger("getSyncableFileData", detail.fileEntry, addReceiver);
                            }
                            else if (action === "updated") {
                                console.log("Update local environment", id);
                                pm.mediator.trigger("getSyncableFileData", detail.fileEntry, updateReceiver);
                            }
                            else if (action === "deleted") {
                                console.log("Delete local environment", id);
                                removeReceiver(id);
                            }
                        }
                        else {
                            console.log("direction was local_to_remote");
                        }
                    }
                    else {
                        console.log("Not synced");
                    }                    
                }                
                else {
                    console.log("Not environment");
                }
            });

            for(i = 0; i < this.models.length; i++) {
                environment = this.models[i];
                synced = environment.get("synced");

                if (synced) {
                    console.log("No need to sync", environment);                    
                }
                else {
                    console.log("Sync", this.getAsSyncableFile(environment.get("id")));
                    this.addToSyncableFilesystem(environment.get("id"));                    
                }
            }
        }
        else {
            console.log("Either environment not loaded or not initialized syncing");
        }
    },

    onReceivingSyncableFileData: function(data) {
        console.log("Received syncable file data", data);

        var collection = this;

        var environment = JSON.parse(data);

        if (!environment) return;

        pm.indexedDB.environments.addEnvironment(environment, function () {                        
            console.log("Added data to onRemoveSyncableFileData");            
            var envModel = new Environment(environment);
            collection.add(envModel, {merge: true});
            collection.updateEnvironmentSyncStatus(environment.id, true);
        });
    },

    onRemoveSyncableFile: function(id) {
        var collection = this;

        pm.indexedDB.environments.deleteEnvironment(id, function () {
            collection.remove(id);
        });
    },

    getAsSyncableFile: function(id) {
        var environment = this.get(id);
        var name = id + ".environment";
        var type = "environment";
        var data = JSON.stringify(environment.toJSON());

        return {
            "name": name,
            "type": type,
            "data": data
        };
    },

    addToSyncableFilesystem: function(id) {
        var collection = this;

        var syncableFile = this.getAsSyncableFile(id);
        pm.mediator.trigger("addSyncableFile", syncableFile, function(result) {
            console.log("Updated environment sync status");
            if(result === "success") {
                collection.updateEnvironmentSyncStatus(id, true);
            }
        });
    },

    removeFromSyncableFilesystem: function(id) {
        var name = id + ".environment";
        pm.mediator.trigger("removeSyncableFile", name, function(result) {
            console.log("Removed file");
        });
    },

    addEnvironment:function (name, values) {
        var collection = this;

        var environment = {
            id:guid(),
            name:name,
            values:values,
            timestamp:new Date().getTime(),
            synced: false            
        };

        console.log("Added environment", environment);
        
        var envModel = new Environment(environment);
        collection.add(envModel);

        pm.indexedDB.environments.addEnvironment(environment, function () {
            collection.addToSyncableFilesystem(environment.id);
        });
    },

    updateEnvironment:function (id, name, values) {
        var collection = this;

        var environment = {
            id:id,
            name:name,
            values:values,
            timestamp:new Date().getTime()
        };

        pm.indexedDB.environments.updateEnvironment(environment, function () {
            var envModel = new Environment(environment);
            collection.add(envModel, {merge: true});
            collection.addToSyncableFilesystem(environment.id);
        });
    },

    updateEnvironmentSyncStatus: function(id, status) {
        var collection = this;

        var environment = this.get(id);
        environment.set("synced", status);
        collection.add(environment, {merge: true});

        console.log("Update environment sync status");

        pm.indexedDB.environments.updateEnvironment(environment.toJSON(), function () {            
            console.log("Updated environment sync status");
        });
    },

    deleteEnvironment:function (id) {
        var collection = this;

        pm.indexedDB.environments.deleteEnvironment(id, function () {
            collection.remove(id);
            collection.removeFromSyncableFilesystem(id);
        });
    },

    downloadEnvironment:function (id) {
        var environment = this.get(id);

        var name = environment.get("name") + ".postman_environment";
        var type = "application/json";
        var filedata = JSON.stringify(environment.toJSON());
        pm.filesystem.saveAndOpenFile(name, filedata, type, function () {
            noty(
                {
                    type:'success',
                    text:'Saved environment to disk',
                    layout:'topCenter',
                    timeout:750
                });
        });
    },

    duplicateEnvironment:function (id) {
        var environment = this.get(id).toJSON();
        environment.name = environment.name + " " + "copy";
        environment.id = guid();

        var collection = this;

        pm.indexedDB.environments.addEnvironment(environment, function () {            
            var envModel = new Environment(environment);
            collection.add(envModel);
            collection.addToSyncableFilesystem(environment.id);
        });
    },

    importEnvironments:function (files) {
        var collection = this;

        // Loop through the FileList
        for (var i = 0, f; f = files[i]; i++) {
            var reader = new FileReader();

            // Closure to capture the file information.
            reader.onload = (function (theFile) {
                return function (e) {
                    // Render thumbnail.
                    var data = e.currentTarget.result;
                    var environment = JSON.parse(data);

                    pm.indexedDB.environments.addEnvironment(environment, function () {                        
                        var envModel = new Environment(environment);
                        collection.add(envModel);
                        collection.trigger("importedEnvironment", environment);

                        collection.addToSyncableFilesystem(environment.id);                 
                    });
                };
            })(f);

            // Read in the image file as a data URL.
            reader.readAsText(f);
        }
    },

    mergeEnvironments: function(environments) {
        var size = environments.length;
        var collection = this;

        function onUpdateEnvironment(environment) {
            var envModel = new Environment(environment);
            collection.set(envModel);

            collection.addToSyncableFilesystem(environment.id);
        }

        for(var i = 0; i < size; i++) {
            var environment = environments[i];
            pm.indexedDB.environments.updateEnvironment(environment, onUpdateEnvironment);
        }
    }
});
