// This should be a nicer standalone todoist model, preferrably with some backing from Doist themselves.

var _ = require("lodash");
var request = require("request-promise");
var uuid = require("node-uuid");

var ROOT_URL = "https://todoist.com/API/v7";

var token = null;
var minutesOffset = 0;

// TODO: Move this to headless OAuth, somehow
exports.login = function (email, password) {
    return request.post(`${ROOT_URL}/user/login`, {
        form: {
            email: email,
            password: password
        },
        json: true
    }).then((response) => {
        token = response.token;
        // TODO: Not currently used, but could be useful to make dates work nicely?
        minutesOffset = response.tz_info.hours * 60;
    });
};

// ** High-level APIs **

exports.addItems = function (items) {
    if (items.length > 50) {
        return Promise.all(
            _.chunk(items, 50).map((chunk, i) => {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        try {
                            resolve(exports.addItems(chunk))
                        } catch (e) { reject(e) }
                    }, 10000 * i);
                });
            })
        ).then((resultArrays) => _.merge.apply(_, resultArrays));
    } else {
        var itemCommands = items.map((item) => ({
            type: "item_add",
            temp_id: item.id || uuid.v1(), // TODO - How should we actually work out what IDs to use?
            uuid: uuid.v1(),
            args: item
        }));

        return exports.writeResources(itemCommands).then((response) => {
            var errors = itemCommands.filter((item) => response.sync_status[item.uuid] !== "ok")
                                     .map((item) => ({ item: item, error: response.sync_status[item.uuid] }));
            if (errors.length > 0) throw new Error(`Failed to create items: ${JSON.stringify(errors)}`);

            return response.temp_id_mapping;
        });
    }
};

exports.addNotes = function (notes) {
    if (notes.length > 100) {
        return Promise.all(
            _.chunk(notes, 100).map((chunk) => exports.addNotes(chunk))
        ).then((resultArrays) => _.merge.apply(_, resultArrays));
    } else {
        var noteCommands = notes.map((note) => ({
            type: "note_add",
            temp_id: uuid.v1(),
            uuid: uuid.v1(),
            args: note
        }));

        return exports.writeResources(noteCommands).then((response) => {
            // TODO: Refactor UUID and error handling into writeResources
            var errors = noteCommands.filter((note) => response.sync_status[note.uuid] !== "ok")
                                     .map((note) => ({ note: note, error: response.sync_status[note.uuid] }));
            if (errors.length > 0) throw new Error(`Failed to create notes: ${JSON.stringify(errors)}`);
        });
    }
};

exports.addLabels = function (labels) {
    var labelCommands = labels.map((label) => ({
        type: "label_add",
        temp_id: label.name,
        uuid: uuid.v1(),
        args: label
    }));

    return exports.writeResources(labelCommands).then((response) => {
        // TODO: Refactor UUID and error handling into writeResources
        var errors = labelCommands.filter((label) => response.sync_status[label.uuid] !== "ok")
                                  .map((label) => ({ label: label, error: response.sync_status[label.uuid] }));
        if (errors.length > 0) throw new Error(`Failed to create labels: ${JSON.stringify(errors)}`);

        return response.temp_id_mapping;
    });
};

// ** Low-level APIs **

exports.readResources = function (resourceTypes = ['all'], syncToken="*") {
    if (!token) throw new Error("Not authenticated - call login() first");

    return request.post(`${ROOT_URL}/sync`, {
        form: {
            token: token,
            resource_types: resourceTypes,
            sync_token: syncToken,
        },
        json: true
    });
};

exports.writeResources = function (commands) {
    if (!token) throw new Error("Not authenticated - call login() first");

    return request.post(`${ROOT_URL}/sync`, {
        form: {
            token: token,
            commands: JSON.stringify(commands)
        },
        json: true
    });
};
