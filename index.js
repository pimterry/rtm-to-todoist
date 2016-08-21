var RTM = require("rtm-js");
var moment = require("moment");
var open = require("open");
var todoist = require("./todoist-sync");
var _ = require("lodash");
var RRule = require("rrule").RRule;

module.exports = function (rtmApiKey, rtmSecret, todoistEmail, todoistPassword) {
    getTasksFromRtm(rtmApiKey, rtmSecret)
        .then(
            (tasks) => addTasksToTodoist(todoistEmail, todoistPassword, tasks)
        ).catch((e) => console.error("Failed to move tasks!", e));
}

function getTasksFromRtm(rtmApiKey, rtmSecret) {
    var rtm = new RTM(rtmApiKey, rtmSecret, 'read');

    return authenticateRtm(rtm).then(() => {
        return new Promise((resolve, reject) => {
            rtm.get('rtm.tasks.getList', function(resp) {
                if (!resp.rsp || !resp.rsp.tasks || !resp.rsp.tasks.list || !resp.rsp.tasks.list[0].taskseries) {
                    reject(`No tasks returned by RTM: ${JSON.stringify(resp)}`);
                }

                var rawTasks = resp.rsp.tasks.list[0].taskseries;
                var incompleteTasks = rawTasks.filter((task) => {
                    if (_.isArray(task.task)) {
                        return task.task.filter((t) => t.completed === '').length > 0;
                    } else {
                        return task.task.completed = '';
                    }
                });
                var tasks = incompleteTasks.map((task) => {
                    // task.task is either an object or *a list of objects* (for tasks that have repeated)
                    // We take the first incomplete task as our relevant example.
                    var taskInstance = _.isArray(task.task) ? _.first(task.task.filter((t) => t.completed === '')) : task.task;

                    return {
                        name: task.name, // string task name
                        priority: taskInstance.priority, // 1, 2, 3, N
                        tags: task.tags.tag ? (_.isArray(task.tags.tag) ? task.tags.tag : [task.tags.tag]) : [], // Array of strings
                        notes: task.notes, // [] if empty. {'note': note object/list} otherwise. notes.note.each.$t or notes.note.$t.
                        url: task.url || null, // string or null
                        repeats: task.rrule || null, // Null or { every: 1, $t: "BYDAY=MO;FREQ=WEEKLY;INTERVAL=1" }

                        added: moment(task.created), // Moment
                        due: taskInstance.due ? moment(taskInstance.due) : null, // Moment or null
                        completed: taskInstance.completed ? moment(taskInstance.completed) : null, // Moment or null
                        deleted: taskInstance.deleted ? moment(taskInstance.deleted) : null // Moment or null
                    }
                }).filter((task) => !!task.name &&
                                    !task.completed &&
                                    !task.deleted /* TODO */); // For some reason, some tasks don't have names??? Drop those.
                resolve(tasks);
            });
        });
    });

    // Want: Name, priority, dates, notes, URL, repeating status
}

function authenticateRtm(rtm) {
    return new Promise((resolve, reject) => {
        rtm.get('rtm.auth.getFrob', function (resp) {
            frob = resp.rsp.frob;

            var authUrl = rtm.getAuthUrl(frob);
            open(authUrl);
            console.log("An authentication page has been opened in your browser.\n");
            console.log("If required, please confirm permissions, then press any key to continue\n");
            process.stdin.resume();

            var waitForKeyPress = function() {
                process.stdin.pause();
                process.stdin.removeListener('data', waitForKeyPress);
                console.log("Continuing...");

                rtm.get('rtm.auth.getToken', {frob: frob}, function(resp){
                    if (!resp.rsp.auth) {
                        reject('Auth token not found. Did you authenticate?');
                    }

                    rtm.auth_token = resp.rsp.auth.token;

                    resolve();
                });
            };
            process.stdin.on('data', waitForKeyPress);
        });
    });
}

function addTasksToTodoist(todoistEmail, todoistPassword, rtmTasks) {
    todoist.login(todoistEmail, todoistPassword).then(() => {
        console.log(JSON.stringify(rtmTasks.map((task) => ({name: task.name, tags: task.tags}))));
        return todoist.addLabels(
            _(rtmTasks).flatMap((task) => task.tags)
                       .uniq()
                       .map((tag) => ({name: tag}))
                       .valueOf()
        );
    }).then((labelsMap) => {
        // TODO: url, notes
        var todoistTasks = rtmTasks.map((task) => ({
            content: task.name,

            priority: {
                1: 4,
                2: 3,
                3: 2,
                'N': 1
            }[task.priority],

            // TODO: think about timezones for this top argument
            date_string: todoistDateStringForRTMTask(task),
            due_date_utc: task.due ? task.due.utc().format("YYYY-MM-DDTHH:mm:59") : undefined,

            // TODO: Check if these actually work.
            checked: !!task.completed,
            is_deleted: !!task.deleted,

            labels: task.tags.map((tag) => labelsMap[tag])
        }));

        return todoist.addItems(todoistTasks);
    }).catch((error) => {
        console.error("Error creating Todoist items", error);
    });
}

function todoistDateStringForRTMTask(task) {
    if (!task.due) return undefined;
    else if (!task.repeats) return task.due.format("YYYY-MM-DD");
    else {
        // RTM API is badly behaved, and doesn't include a timezone signifier in UNTIL clauses
        // Here we manually add one, so our RRule parser is happy.
        var repeatPattern = task.repeats.$t.replace(/(UNTIL=[\dT]+)($|;)/, "$1Z$2");

        // We just return a human-reable version of this, seems to be fine for Todoist.
        // Note that task.repeats has an 'every' property - seems to be always 1; we just ignore it.
        return RRule.fromString(repeatPattern).toText();
    }
};
