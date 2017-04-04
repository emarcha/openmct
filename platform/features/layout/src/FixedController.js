/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2016, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define(
    ['./FixedProxy', './elements/ElementProxies', './FixedDragHandle'],
    function (FixedProxy, ElementProxies, FixedDragHandle) {

        var DEFAULT_DIMENSIONS = [2, 1];

        /**
         * The FixedController is responsible for supporting the
         * Fixed Position view. It arranges frames according to saved
         * configuration and provides methods for updating these based on
         * mouse movement.
         * @memberof platform/features/layout
         * @constructor
         * @param {Scope} $scope the controller's Angular scope
         */
        function FixedController($scope, $q, dialogService, openmct) {
            var self = this,
                names = {}, // Cache names by ID
                values = {}, // Cache values by ID
                elementProxiesById = {},
                maxDomainValue = Number.POSITIVE_INFINITY;
            var subscriptions = [];

            // Convert from element x/y/width/height to an
            // appropriate ng-style argument, to position elements.
            function convertPosition(elementProxy) {
                var gridSize = self.gridSize;
                // Multiply position/dimensions by grid size
                return {
                    left: (gridSize[0] * elementProxy.x()) + 'px',
                    top: (gridSize[1] * elementProxy.y()) + 'px',
                    width: (gridSize[0] * elementProxy.width()) + 'px',
                    height: (gridSize[1] * elementProxy.height()) + 'px'
                };
            }

            // Update the style for a selected element
            function updateSelectionStyle() {
                var element = self.selection && self.selection.get();
                if (element) {
                    element.style = convertPosition(element);
                }
            }

            // Generate a specific drag handle
            function generateDragHandle(elementHandle) {
                return new FixedDragHandle(
                    elementHandle,
                    self.gridSize,
                    updateSelectionStyle,
                    $scope.commit
                );
            }

            // Generate drag handles for an element
            function generateDragHandles(element) {
                return element.handles().map(generateDragHandle);
            }

            // Update the value displayed in elements of this telemetry object
            function setDisplayedValue(telemetryObject, value, alarm) {
                var id = telemetryObject.identifier.key;
                var formatter = formatters[telemetryObject];

                (elementProxiesById[id] || []).forEach(function (element) {
                    names[id] = telemetryObject.name;
                    values[id] = formatter.format(value);
                    element.name = names[id];
                    element.value = values[id];
                    element.cssClass = alarm && alarm.cssClass;
                });
            }

            // Update the displayed value for this object
            function updateValue(telemetryObject, datum) {
                var timeSystem = openmct.conductor.timeSystem();
                var metadata = openmct.telemetry.getMetadata(telemetryObject);
                var domain = timeSystem && timeSystem.metadata.key;
                // Use first available range *shrug*
                var rangeField = metadata.valuesForHints(['range'])[0].key;
                var limitEvaluator = openmct.telemetry.limitEvaluator(telemetryObject);

                var domainValue = domain && datum[domain];
                var rangeValue = rangeField && datum[rangeField];

                if (timeSystem && domainValue < maxDomainValue) {
                    setDisplayedValue(
                        telemetryObject,
                        rangeValue,
                        limitEvaluator && limitEvaluator.evaluate(datum, rangeField)
                    );
                }
            }

            // Update element positions when grid size changes
            function updateElementPositions(layoutGrid) {
                // Update grid size from model
                self.gridSize = layoutGrid;

                self.elementProxies.forEach(function (elementProxy) {
                    elementProxy.style = convertPosition(elementProxy);
                });
            }

            // Decorate an element for display
            function makeProxyElement(element, index, elements) {
                var ElementProxy = ElementProxies[element.type],
                    e = ElementProxy && new ElementProxy(element, index, elements);

                if (e) {
                    // Provide a displayable position (convert from grid to px)
                    e.style = convertPosition(e);
                    // Template names are same as type names, presently
                    e.template = element.type;
                }

                return e;
            }

            // Decorate elements in the current configuration
            function refreshElements() {
                // Cache selection; we are instantiating new proxies
                // so we may want to restore this.
                var selected = self.selection && self.selection.get(),
                    elements = (($scope.configuration || {}).elements || []),
                    index = -1; // Start with a 'not-found' value

                // Find the selection in the new array
                if (selected !== undefined) {
                    index = elements.indexOf(selected.element);
                }

                // Create the new proxies...
                self.elementProxies = elements.map(makeProxyElement);

                // Clear old selection, and restore if appropriate
                if (self.selection) {
                    self.selection.deselect();
                    if (index > -1) {
                        self.select(self.elementProxies[index]);
                    }
                }

                // Finally, rebuild lists of elements by id to
                // facilitate faster update when new telemetry comes in.
                elementProxiesById = {};
                self.elementProxies.forEach(function (elementProxy) {
                    var id = elementProxy.id;
                    if (elementProxy.element.type === 'fixed.telemetry') {
                        // Provide it a cached name/value to avoid flashing
                        elementProxy.name = names[id];
                        elementProxy.value = values[id];
                        elementProxiesById[id] = elementProxiesById[id] || [];
                        elementProxiesById[id].push(elementProxy);
                    }
                });
            }

            function unsubscribe() {
                subscriptions.forEach(function (unsubscribeFunc) {
                    unsubscribeFunc();
                });
                subscriptions = [];
            }

            function filterForTelemetryObjects(objects) {
                return objects.filter(openmct.telemetry.canProvideTelemetry.bind(openmct.telemetry));
            }

            function subscribeToTelemetry(telemetryObjects) {
                subscriptions = telemetryObjects.map(function(object) {
                    return openmct.telemetry.subscribe(object, updateValue.bind(object));
                });
                return telemetryObjects;
            }

            // Subscribe to telemetry updates for this domain object
            function subscribe(domainObject) {
                var newObject = domainObject.useCapability('adapter');

                if (subscriptions.length > 0) {
                    unsubscribe();
                }

                if (openmct.telemetry.canProvideTelemetry(newObject)){
                    subscriptions = [openmct.telemetry.subscribe(newObject)];
                } else {
                    openmct.composition.get(newObject).load()
                        .then(filterForTelemetryObjects)
                        .then(subscribeToTelemetry);
                }
            }

            // Handle changes in the object's composition
            function updateComposition() {
                // Resubscribe - objects in view have changed
                subscribe($scope.domainObject);
            }

            // Trigger a new query for telemetry data
            function updateDisplayBounds(event, bounds) {
                maxDomainValue = bounds.end;
                // Get historical telemetry and show last value
            }

            // Add an element to this view
            function addElement(element) {
                // Ensure that configuration field is populated
                $scope.configuration = $scope.configuration || {};
                // Make sure there is a "elements" field in the
                // view configuration.
                $scope.configuration.elements =
                    $scope.configuration.elements || [];
                // Store the position of this element.
                $scope.configuration.elements.push(element);
                // Refresh displayed elements
                refreshElements();
                // Select the newly-added element
                self.select(
                    self.elementProxies[self.elementProxies.length - 1]
                );
                // Mark change as persistable
                if ($scope.commit) {
                    $scope.commit("Dropped an element.");
                }
            }

            // Position a panel after a drop event
            function handleDrop(e, id, position) {
                // Don't handle this event if it has already been handled
                // color is set to "" to let the CSS theme determine the default color
                if (e.defaultPrevented) {
                    return;
                }

                e.preventDefault();
                // Store the position of this element.
                addElement({
                    type: "fixed.telemetry",
                    x: Math.floor(position.x / self.gridSize[0]),
                    y: Math.floor(position.y / self.gridSize[1]),
                    id: id,
                    stroke: "transparent",
                    color: "",
                    titled: true,
                    width: DEFAULT_DIMENSIONS[0],
                    height: DEFAULT_DIMENSIONS[1]
                });
            }

            this.elementProxies = [];
            this.generateDragHandle = generateDragHandle;
            this.generateDragHandles = generateDragHandles;

            // Track current selection state
            $scope.$watch("selection", function (selection) {
                this.selection = selection;

                // Expose the view's selection proxy
                if (this.selection) {
                    this.selection.proxy(
                        new FixedProxy(addElement, $q, dialogService)
                    );
                }
            }.bind(this));

            // Detect changes to grid size
            $scope.$watch("model.layoutGrid", updateElementPositions);

            // Refresh list of elements whenever model changes
            $scope.$watch("model.modified", refreshElements);

            // Position panes when the model field changes
            $scope.$watch("model.composition", updateComposition);

            // Subscribe to telemetry when an object is available
            $scope.$watch("domainObject", subscribe);

            // Free up subscription on destroy
            $scope.$on("$destroy", unsubscribe);

            // Position panes where they are dropped
            $scope.$on("mctDrop", handleDrop);

            // Respond to external bounds changes
            $scope.$on("telemetry:display:bounds", updateDisplayBounds);
        }

        /**
         * Get the size of the grid, in pixels. The returned array
         * is in the form `[x, y]`.
         * @returns {number[]} the grid size
         * @memberof platform/features/layout.FixedController#
         */
        FixedController.prototype.getGridSize = function () {
            return this.gridSize;
        };

        /**
         * Get an array of elements in this panel; these are
         * decorated proxies for both selection and display.
         * @returns {Array} elements in this panel
         */
        FixedController.prototype.getElements = function () {
            return this.elementProxies;
        };

        /**
         * Check if the element is currently selected, or (if no
         * argument is supplied) get the currently selected element.
         * @returns {boolean} true if selected
         */
        FixedController.prototype.selected = function (element) {
            var selection = this.selection;
            return selection && ((arguments.length > 0) ?
                    selection.selected(element) : selection.get());
        };

        /**
         * Set the active user selection in this view.
         * @param element the element to select
         */
        FixedController.prototype.select = function select(element) {
            if (this.selection) {
                // Update selection...
                this.selection.select(element);
                // ...as well as move, resize handles
                this.mvHandle = this.generateDragHandle(element);
                this.resizeHandles = this.generateDragHandles(element);
            }
        };

        /**
         * Clear the current user selection.
         */
        FixedController.prototype.clearSelection = function () {
            if (this.selection) {
                this.selection.deselect();
                this.resizeHandles = [];
                this.mvHandle = undefined;
            }
        };

        /**
         * Get drag handles.
         * @returns {platform/features/layout.FixedDragHandle[]}
         *          drag handles for the current selection
         */
        FixedController.prototype.handles = function () {
            return this.resizeHandles;
        };

        /**
         * Get the handle to handle dragging to reposition an element.
         * @returns {platform/features/layout.FixedDragHandle} the drag handle
         */
        FixedController.prototype.moveHandle = function () {
            return this.mvHandle;
        };

        return FixedController;
    }
);

